import AMapLoader from "@amap/amap-jsapi-loader";

type AMapNamespace = Record<string, any>;

let amapPromise: Promise<AMapNamespace> | null = null;

export function hasAmapBrowserKey(): boolean {
  return Boolean(import.meta.env.VITE_AMAP_JS_KEY);
}

export function loadAmap(): Promise<AMapNamespace> {
  if (amapPromise) {
    return amapPromise;
  }

  const key = import.meta.env.VITE_AMAP_JS_KEY;
  const securityJsCode = import.meta.env.VITE_AMAP_SECURITY_JS_CODE;
  if (!key) {
    return Promise.reject(new Error("缺少 VITE_AMAP_JS_KEY。"));
  }

  if (securityJsCode) {
    window._AMapSecurityConfig = { securityJsCode };
  }

  amapPromise = AMapLoader.load({
    key,
    version: "2.0",
    plugins: ["AMap.Scale", "AMap.ToolBar"]
  });

  return amapPromise;
}

declare global {
  interface Window {
    _AMapSecurityConfig?: {
      securityJsCode: string;
    };
  }
}
