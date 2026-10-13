/* KPI sparklines. Decorative: the KPI value
   beside it is the content, so the SVG is hidden from assistive technology.
   Plain SVG rather than a Chart.js instance per card: four tiny charts do
   not need axes, tooltips or a canvas each. */
interface Props {
  values: readonly number[];
  color: string;
}

export function Sparkline({ values, color }: Props) {
  if (values.length < 2) return <div className="spark spark-empty" aria-hidden="true" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const W = 100;
  const H = 28;
  const pad = 2;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * W).toFixed(2)},${(pad + (1 - (v - min) / span) * (H - pad * 2)).toFixed(2)}`)
    .join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polyline points={points} fill="none" style={{ stroke: color }} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
