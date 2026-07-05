#!/usr/bin/env bash
# Build + deploy helper for the CampusGeo query Lambda.
# The deployment package (campusgeo-lambda.zip) is NOT committed to git —
# rebuild it from source with this script whenever handler.js changes.
set -euo pipefail
cd "$(dirname "$0")"

npm install --omit=dev --no-audit --no-fund
rm -f campusgeo-lambda.zip
zip -rq campusgeo-lambda.zip handler.js package.json node_modules

echo "Built campusgeo-lambda.zip ($(du -h campusgeo-lambda.zip | cut -f1))"
echo
echo "Deploy with:"
echo "  aws lambda update-function-code \\"
echo "    --function-name campusgeo-query \\"
echo "    --zip-file fileb://campusgeo-lambda.zip \\"
echo "    --region us-east-1"
