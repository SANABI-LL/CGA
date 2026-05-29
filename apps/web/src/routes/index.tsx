import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { LandingPage } from './LandingPage'
import { MapApp } from './MapApp'

const rootRoute = createRootRoute({
  component: () => <Outlet />,
})

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
})

const mapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/map',
  component: MapApp,
})

export const routeTree = rootRoute.addChildren([landingRoute, mapRoute])

export { createRouter }
