// Fichier de correction des types pour résoudre les erreurs spécifiques
import * as L from 'leaflet';

declare module 'react-leaflet' {
  // Étendre les props pour MapContainer
  interface MapContainerProps {
    center?: L.LatLngExpression;
    zoom?: number;
    scrollWheelZoom?: boolean;
    className?: string;
  }

  // Étendre les props pour TileLayer
  interface TileLayerProps {
    attribution?: string;
    url: string;
  }

  // Étendre les props pour CircleMarker
  interface CircleMarkerProps {
    center: L.LatLngExpression;
    radius?: number;
    pathOptions?: L.PathOptions;
    eventHandlers?: L.LeafletEventHandlerFnMap;
  }

  // Étendre les props pour Tooltip
  interface TooltipProps {
    children: React.ReactNode;
    permanent?: boolean;
    sticky?: boolean;
    direction?: 'right' | 'left' | 'top' | 'bottom' | 'center' | 'auto';
    offset?: L.PointExpression;
    opacity?: number;
  }
}