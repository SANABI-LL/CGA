#!/usr/bin/env python3
"""
PD 43 planning-document ingestion for the CampusGeo RAG knowledge base.

Pipeline (all local, one-shot — S3 only stores the final index):
  1. Extract text from PDFs under --source (pypdf). Scanned/image PDFs are
     detected by average extractable chars per page and excluded — run with
     --list-only to see the extraction report before embedding anything.
  2. Chunk page text into ~800-token passages with paragraph packing and
     one-paragraph overlap, keeping {docName, page} provenance per chunk.
  3. Embed each chunk with Bedrock Titan Text Embeddings V2 (1024-dim).
  4. Write a single JSON index (chunks + embeddings + metadata) to
     gis_output/documents/, optionally upload to S3 with --upload.

Usage:
  python ingest_documents.py --list-only            # extraction report only, no AWS calls
  python ingest_documents.py                        # build index locally
  python ingest_documents.py --upload               # build + upload to s3://<bucket>/documents/

Requires: pip install pypdf boto3; AWS credentials for embedding/upload steps.
Phase 2 (deferred): OCR / multimodal parsing for scanned drawings, docx/xlsx.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from pypdf import PdfReader

# --- Tunables -----------------------------------------------------------

# Below this average of extractable characters per page a PDF is treated as
# scanned (image-only) and excluded from Phase 1.
MIN_CHARS_PER_PAGE = 200

# Chunk sizing. Titan V2 accepts up to ~8k tokens; we target small passages
# for precise retrieval. Tokens are approximated as chars / 4.
TARGET_CHUNK_CHARS = 3200   # ~800 tokens
MIN_CHUNK_CHARS = 300       # merge fragments smaller than this into neighbors

# Explicitly excluded documents (in addition to the scanned-PDF heuristic).
# Keys are exact filenames under --source; values are the reason shown in the report.
EXCLUDED_DOCS: dict[str, str] = {
    "2013_05_08_VI_VII_Journal of the Proceedings.pdf":
        "full 1,874-page citywide journal; PD43 excerpts are indexed instead",
    "2013_PD43_Pages from 2013_05_08_VI_VII_Journal of the Proceedings_additional.pdf":
        "byte-identical duplicate of the non-'additional' excerpt",
    "PD43 as of 12 8 21.pdf":
        "same drawing set as the (compressed) copy",
    "PD43 as of 12 8 21(compressed).pdf":
        "drawing set; extractable text is title-block fragments - Phase 2 OCR",
    "PD43 as of  9-18-23.pdf":
        "drawing set; extractable text is title-block fragments - Phase 2 OCR",
}

EMBED_MODEL_ID = "amazon.titan-embed-text-v2:0"
EMBED_DIMENSIONS = 1024
DEFAULT_BUCKET = "campusgeo-geodata-491117467175"
DEFAULT_REGION = "us-east-1"
DEFAULT_SOURCE = Path(__file__).parent / "PD 43 (Campus)"
DEFAULT_OUTPUT = Path(__file__).parent / "gis_output" / "documents" / "pd43_index.json"
S3_KEY = "documents/pd43_index.json"


@dataclass
class DocReport:
    name: str
    pages: int = 0
    avg_chars: float = 0.0
    included: bool = False
    reason: str = ""
    chunks: int = 0


@dataclass
class Chunk:
    doc_name: str
    page: int
    text: str
    embedding: list[float] = field(default_factory=list)


# --- Extraction ---------------------------------------------------------

def extract_pdf(path: Path) -> tuple[list[tuple[int, str]], DocReport]:
    """Return [(page_number, text), ...] plus an extraction report."""
    report = DocReport(name=path.name)
    try:
        reader = PdfReader(str(path))
    except Exception as err:  # corrupt / encrypted PDFs
        report.reason = f"unreadable ({type(err).__name__})"
        return [], report

    pages: list[tuple[int, str]] = []
    total_chars = 0
    for i, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        text = normalize_text(text)
        total_chars += len(text)
        if text:
            pages.append((i + 1, text))

    report.pages = len(reader.pages)
    report.avg_chars = total_chars / max(1, len(reader.pages))

    if report.avg_chars < MIN_CHARS_PER_PAGE:
        report.reason = f"scanned/image PDF (avg {report.avg_chars:.0f} chars/page) - Phase 2 OCR"
        return [], report

    report.included = True
    return pages, report


def normalize_text(text: str) -> str:
    """Collapse extraction artifacts while preserving paragraph breaks."""
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# --- Chunking ------------------------------------------------------------

def chunk_pages(doc_name: str, pages: list[tuple[int, str]]) -> list[Chunk]:
    """Pack paragraphs into ~TARGET_CHUNK_CHARS chunks, one chunk never
    spanning pages (keeps provenance exact), with one-paragraph overlap."""
    chunks: list[Chunk] = []
    for page_no, text in pages:
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        if not paragraphs:
            continue
        current: list[str] = []
        current_len = 0
        for para in paragraphs:
            if current and current_len + len(para) > TARGET_CHUNK_CHARS:
                chunks.append(Chunk(doc_name, page_no, "\n\n".join(current)))
                # one-paragraph overlap so clauses split across chunks stay findable
                current = [current[-1], para]
                current_len = len(current[-2]) + len(para)
            else:
                current.append(para)
                current_len += len(para)
        if current:
            tail = "\n\n".join(current)
            if len(tail) < MIN_CHUNK_CHARS and chunks and chunks[-1].page == page_no:
                chunks[-1].text += "\n\n" + tail
            else:
                chunks.append(Chunk(doc_name, page_no, tail))
    return chunks


# --- Embedding -----------------------------------------------------------

def embed_chunks(chunks: list[Chunk], region: str) -> None:
    import boto3

    client = boto3.client("bedrock-runtime", region_name=region)
    for i, chunk in enumerate(chunks):
        body = json.dumps({
            "inputText": chunk.text[: TARGET_CHUNK_CHARS * 2],
            "dimensions": EMBED_DIMENSIONS,
            "normalize": True,
        })
        for attempt in range(3):
            try:
                resp = client.invoke_model(modelId=EMBED_MODEL_ID, body=body)
                chunk.embedding = json.loads(resp["body"].read())["embedding"]
                break
            except Exception as err:
                if attempt == 2:
                    raise
                print(f"  retry {attempt + 1} on chunk {i}: {err}")
                time.sleep(2 ** attempt)
        if (i + 1) % 25 == 0 or i + 1 == len(chunks):
            print(f"  embedded {i + 1}/{len(chunks)}")


# --- Main ----------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Build the PD 43 RAG index")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--list-only", action="store_true",
                        help="extraction report only; no embedding, no AWS calls")
    parser.add_argument("--upload", action="store_true",
                        help=f"upload index to s3://<bucket>/{S3_KEY}")
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    parser.add_argument("--region", default=DEFAULT_REGION)
    args = parser.parse_args()

    if not args.source.is_dir():
        print(f"source directory not found: {args.source}")
        return 1

    pdfs = sorted(args.source.glob("*.pdf"))  # top level only; subfolders are Phase 2
    if not pdfs:
        print(f"no PDFs found in {args.source}")
        return 1

    print(f"Scanning {len(pdfs)} PDFs in {args.source.name}/ "
          f"(threshold: {MIN_CHARS_PER_PAGE} chars/page)\n")

    all_chunks: list[Chunk] = []
    reports: list[DocReport] = []
    for pdf in pdfs:
        if pdf.name in EXCLUDED_DOCS:
            reports.append(DocReport(name=pdf.name, reason=EXCLUDED_DOCS[pdf.name]))
            continue
        pages, report = extract_pdf(pdf)
        if report.included:
            doc_chunks = chunk_pages(pdf.name, pages)
            report.chunks = len(doc_chunks)
            all_chunks.extend(doc_chunks)
        reports.append(report)

    # Extraction report
    width = max(len(r.name) for r in reports)
    print(f"{'document':<{width}}  {'pages':>5}  {'chars/pg':>8}  {'chunks':>6}  status")
    print("-" * (width + 40))
    for r in reports:
        status = "INCLUDED" if r.included else f"excluded: {r.reason}"
        print(f"{r.name:<{width}}  {r.pages:>5}  {r.avg_chars:>8.0f}  {r.chunks:>6}  {status}")
    included = [r for r in reports if r.included]
    print(f"\n{len(included)}/{len(reports)} documents included, "
          f"{len(all_chunks)} chunks total")

    if args.list_only:
        return 0
    if not all_chunks:
        print("nothing to embed")
        return 1

    print(f"\nEmbedding with {EMBED_MODEL_ID} ({EMBED_DIMENSIONS}d) in {args.region}...")
    embed_chunks(all_chunks, args.region)

    index = {
        "version": 1,
        "model": EMBED_MODEL_ID,
        "dimensions": EMBED_DIMENSIONS,
        "corpus": "PD 43 (Campus) - text-layer PDFs only (Phase 1)",
        "documents": [r.name for r in included],
        "chunks": [
            {"id": i, "doc": c.doc_name, "page": c.page,
             "text": c.text,
             # 5 decimals keeps cosine similarity intact and halves index size
             "embedding": [round(x, 5) for x in c.embedding]}
            for i, c in enumerate(all_chunks)
        ],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(index), encoding="utf-8")
    size_mb = args.output.stat().st_size / 1_048_576
    print(f"wrote {args.output} ({size_mb:.1f} MB)")

    if args.upload:
        import boto3
        s3 = boto3.client("s3", region_name=args.region)
        s3.upload_file(str(args.output), args.bucket, S3_KEY,
                       ExtraArgs={"ContentType": "application/json"})
        print(f"uploaded to s3://{args.bucket}/{S3_KEY}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
