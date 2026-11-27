import { Fragment } from "react";
import { parseRich, type Span } from "./rich";

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => (
        <Fragment key={i}>{s.bold ? <strong>{s.text}</strong> : s.italic ? <em>{s.text}</em> : s.text}</Fragment>
      ))}
    </>
  );
}

/** An answer with its **bold**, *italic* and bullet lines shown properly. Text only: nothing is rendered as HTML. */
export function Rich({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parseRich(text).map((b, i) =>
        b.type === "p" ? (
          <p key={i}>
            <Spans spans={b.spans} />
          </p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
