/* The table view of a chart card: the same numbers as the chart. It fills
   the card's view region and scrolls inside it (sticky header), so a
   multi-year daily series never grows the card. The scroller is focusable
   so keyboard users can scroll it. */
interface Props {
  caption: string;
  headers: readonly [string, string];
  rows: readonly (readonly [string, string])[];
}

export function DataTable({ caption, headers, rows }: Props) {
  return (
    <div className="data-table" role="region" aria-label={caption} tabIndex={0}>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr><th scope="col">{headers[0]}</th><th scope="col">{headers[1]}</th></tr>
        </thead>
        <tbody>
          {rows.map(([a, b], i) => (
            <tr key={i}><th scope="row">{a}</th><td>{b}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
