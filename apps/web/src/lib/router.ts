import { useEffect, useState } from "react";

/** Two routes is not worth a router: `/` and `/room/:code`. */
export type Route = { name: "home" } | { name: "room"; code: string } | { name: "mock" };

function parse(pathname: string): Route {
  if (/^\/mock\/?$/.test(pathname)) return { name: "mock" };
  const match = /^\/room\/([A-Za-z0-9]+)\/?$/.exec(pathname);
  return match ? { name: "room", code: match[1].toUpperCase() } : { name: "home" };
}

export function navigate(path: string) {
  history.pushState({}, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.pathname));

  useEffect(() => {
    const update = () => setRoute(parse(location.pathname));
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);

  return route;
}

export const roomUrl = (code: string) => `${location.origin}/room/${code}`;
