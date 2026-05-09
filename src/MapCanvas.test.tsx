import { render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { MapCanvas } from "./MapCanvas";
import type { Coordinate, SavedRoute } from "./shared/types";

const amapMock = vi.hoisted(() => {
  const setFitView = vi.fn();
  const map = {
    add: vi.fn(),
    addControl: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
    remove: vi.fn(),
    resize: vi.fn(),
    setCenter: vi.fn(),
    setZoomAndCenter: vi.fn(),
    setFitView
  };

  class Marker {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  class Polyline {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  return {
    map,
    setFitView,
    AMap: {
      Map: vi.fn(() => map),
      Marker,
      Polyline,
      Scale: vi.fn(),
      ToolBar: vi.fn()
    }
  };
});

vi.mock("./amap", () => ({
  hasAmapBrowserKey: () => true,
  loadAmap: () => Promise.resolve(amapMock.AMap)
}));

const origin: Coordinate = { lng: 121.4737, lat: 31.2304 };
const locatedOrigin: Coordinate = { lng: 121.5, lat: 31.24 };

const historyRoute: SavedRoute = {
  id: "history-1",
  name: "历史路线",
  distanceM: 1000,
  targetDistanceM: 1000,
  overlapPct: 0,
  score: 100,
  returnToStart: true,
  createdAt: "2026-05-10T00:00:00.000Z",
  path: [
    { lng: 121.2, lat: 31.1 },
    { lng: 121.8, lat: 31.4 }
  ],
  waypoints: [],
  steps: [],
  segmentKeys: [],
  warnings: []
};

function renderMapCanvas(props?: Partial<ComponentProps<typeof MapCanvas>>) {
  return render(
    <MapCanvas
      origin={origin}
      candidates={[]}
      selectedRouteId={null}
      history={[historyRoute]}
      focusedHistoryId={null}
      currentPosition={null}
      activeStepIndex={0}
      isNavigating={false}
      focusRequest={0}
      originFocusRequest={0}
      showHistory
      onOriginChange={vi.fn()}
      {...props}
    />
  );
}

describe("MapCanvas focus", () => {
  it("centers the map on the origin when an origin focus request is received", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });

    const { rerender } = renderMapCanvas();

    await waitFor(() => expect(amapMock.AMap.Map).toHaveBeenCalled());
    rerender(
      <MapCanvas
        origin={origin}
        candidates={[]}
        selectedRouteId={null}
        history={[historyRoute]}
        focusedHistoryId={null}
        currentPosition={null}
        activeStepIndex={0}
        isNavigating={false}
        focusRequest={0}
        originFocusRequest={0}
        showHistory
        onOriginChange={vi.fn()}
      />
    );
    await waitFor(() => expect(amapMock.setFitView).toHaveBeenCalled());
    amapMock.setFitView.mockClear();
    amapMock.map.setZoomAndCenter.mockClear();
    amapMock.map.setCenter.mockClear();

    rerender(
      <MapCanvas
        origin={locatedOrigin}
        candidates={[]}
        selectedRouteId={null}
        history={[historyRoute]}
        focusedHistoryId={null}
        currentPosition={null}
        activeStepIndex={0}
        isNavigating={false}
        focusRequest={0}
        originFocusRequest={1}
        showHistory
        onOriginChange={vi.fn()}
      />
    );

    await waitFor(() => expect(amapMock.map.setZoomAndCenter).toHaveBeenCalled());
    const [, center] = amapMock.map.setZoomAndCenter.mock.calls.at(-1) ?? [];

    expect(amapMock.setFitView).toHaveBeenCalledTimes(1);
    expect(center).toEqual([locatedOrigin.lng, locatedOrigin.lat]);
    expect(amapMock.map.setCenter).not.toHaveBeenCalled();
  });
});
