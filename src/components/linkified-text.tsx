import type { ReactNode } from "react";

type LinkifiedTextProps = {
  text: string;
};

const urlPattern = /https?:\/\/[^\s<>"']+/gi;
const trailingPunctuation = /[.,!?;:]$/;
const closingPairs: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

function trimUrlPunctuation(value: string) {
  let url = value;

  while (url) {
    if (trailingPunctuation.test(url)) {
      url = url.slice(0, -1);
      continue;
    }

    const lastCharacter = url.at(-1);
    const openingCharacter = lastCharacter ? closingPairs[lastCharacter] : undefined;
    if (openingCharacter) {
      const openingCount = [...url].filter((character) => character === openingCharacter).length;
      const closingCount = [...url].filter((character) => character === lastCharacter).length;
      if (closingCount > openingCount) {
        url = url.slice(0, -1);
        continue;
      }
    }

    break;
  }

  return url;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function LinkifiedText({ text }: LinkifiedTextProps) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(urlPattern)) {
    const candidate = match[0];
    const url = trimUrlPunctuation(candidate);
    const index = match.index ?? 0;

    if (!url || !isHttpUrl(url)) continue;

    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    parts.push(
      <a
        key={`url-${index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900 hover:decoration-violet-600"
      >
        {url}
      </a>,
    );
    parts.push(candidate.slice(url.length));
    lastIndex = index + candidate.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return <>{parts}</>;
}
