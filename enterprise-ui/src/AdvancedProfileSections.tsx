import type { ProfileRun } from './types';

export function AdvancedProfileTable({ run }: { run: ProfileRun }) {
  return <section className="panel">
    <div className="panel-heading"><div><h2>Advanced column profile</h2><p>Distribution shape, cardinality, key classification, outliers, patterns, lengths, and date ranges.</p></div></div>
    <div className="table-wrap"><table><thead><tr><th>Column</th><th>Classification</th><th>Cardinality</th><th>Outliers</th><th>Skewness</th><th>Kurtosis</th><th>Pattern</th><th>Additional range</th></tr></thead><tbody>{run.columns.map((column) => {
      const range = column.textStats
        ? `${column.textStats.minLength}–${column.textStats.maxLength} chars · avg ${column.textStats.meanLength.toFixed(1)}`
        : column.dateStats?.min && column.dateStats?.max
          ? `${column.dateStats.min.slice(0, 10)} → ${column.dateStats.max.slice(0, 10)}`
          : column.numericStats
            ? `${column.numericStats.min.toLocaleString()} → ${column.numericStats.max.toLocaleString()}`
            : '—';
      return <tr key={column.name}><td><strong>{column.name}</strong><span className="cell-subtitle">{column.inferredType}</span></td><td>{column.classification ?? 'Categorical/other'}</td><td>{((column.cardinalityRatio ?? 0) * 100).toFixed(1)}%</td><td>{column.outlierCount.toLocaleString()}</td><td>{column.numericStats?.skewness === undefined ? '—' : column.numericStats.skewness.toFixed(3)}</td><td>{column.numericStats?.kurtosis === undefined ? '—' : column.numericStats.kurtosis.toFixed(3)}</td><td>{column.dominantPattern ? <><code>{column.dominantPattern}</code><span className="cell-subtitle">{column.dominantPatternPercentage?.toFixed(1)}%</span></> : '—'}</td><td>{range}</td></tr>;
    })}</tbody></table></div>
  </section>;
}

function correlationValue(run: ProfileRun, left: string, right: string): number | undefined {
  if (left === right) return 1;
  const value = run.correlations?.find((item) => (item.left === left && item.right === right) || (item.left === right && item.right === left));
  return value?.value;
}

export function CorrelationMatrix({ run }: { run: ProfileRun }) {
  const numeric = run.columns.filter((column) => column.inferredType === 'integer' || column.inferredType === 'decimal').map((column) => column.name);
  if (numeric.length < 2) return <section className="empty-state compact-empty"><h2>Correlation requires at least two numeric columns</h2><p>This run does not have enough numeric columns to calculate a Pearson correlation matrix.</p></section>;
  return <section className="panel">
    <div className="panel-heading"><div><h2>Correlation matrix</h2><p>Pearson correlation across numeric columns. Correlation describes movement together; it does not prove causation.</p></div></div>
    <div className="table-wrap correlation-table"><table><thead><tr><th>Column</th>{numeric.map((name) => <th key={name}>{name}</th>)}</tr></thead><tbody>{numeric.map((left) => <tr key={left}><th>{left}</th>{numeric.map((right) => {
      const value = correlationValue(run, left, right);
      const strength = value === undefined ? '' : Math.abs(value) >= .8 ? 'strong' : Math.abs(value) >= .5 ? 'moderate' : 'weak';
      return <td key={right} className={`correlation-cell ${strength}`}>{value === undefined ? '—' : value.toFixed(2)}</td>;
    })}</tr>)}</tbody></table></div>
  </section>;
}
