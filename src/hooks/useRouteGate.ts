import { createContext, useContext } from 'react';

/**
 * True while the route guard is about to send this screen elsewhere. The
 * navigator stays mounted under the guard's cover so the redirect can land, so
 * a screen that acts on arrival (save, analysis) has to wait for this itself.
 */
export const RouteGateContext = createContext(false);
export const useRouteGate = () => useContext(RouteGateContext);
