"use client";

import { useState } from "react";
import BandSearch from "@/components/band-search";
import BandEntryFlow from "@/components/band-entry-flow";

export default function BandDiscovery() {
  const [historyVersion, setHistoryVersion] = useState(0);
  return <>
    <BandSearch onRequestsChanged={() => setHistoryVersion(version => version + 1)} />
    <BandEntryFlow key={historyVersion} />
  </>;
}
