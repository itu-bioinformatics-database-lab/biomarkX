import React from 'react';

const Chip = ({ children, color = '#e8eefc', textColor = '#2f4fb5' }) => (
  <span
    style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '999px',
      background: color,
      color: textColor,
      fontWeight: 700,
      fontSize: 12,
      marginRight: 8,
      whiteSpace: 'nowrap'
    }}
  >
    {children}
  </span>
);

export default function AggregationHelpContent() {
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Aggregation methods</div>
      <div style={{ color: '#444', marginBottom: 10 }}>
        Combine multiple biomarker lists into one consensus Top-N list.
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Rank-based vs weight-based</div>
        <div style={{ color: '#444' }}>
          <b>Rank-based</b> methods only use the ordering (1st, 2nd, 3rd...) from each analysis.
          <br />
          <b>Weight-based</b> methods use the continuous importance magnitudes (e.g., SHAP value, model importance).
        </div>
      </div>

      <div style={{ fontWeight: 700, marginBottom: 6 }}>Rank-based methods</div>
      <ul style={{ paddingLeft: 16, margin: 0, listStyle: 'none' }}>
        <li style={{ marginBottom: 8 }}>
          <Chip color="#eef2f7" textColor="#334155">Mean Rank</Chip>
          Adds ranks equally; easy to interpret but a bit more sensitive to outliers and number of lists.
        </li>
        <li style={{ marginBottom: 8 }}>
          <Chip color="#fff3e1" textColor="#b55a00">Weighted Borda Count (Weighted Mean Rank)</Chip>
          Sums ranks with optional <b>weights</b>; give higher weight to methods you trust more (e.g., SHAP &gt; t-test).
        </li>
        <li style={{ marginBottom: 8 }}>
          <Chip color="#eaf2ff" textColor="#1d4ed8">Median Rank</Chip>
          Uses the median rank to reduce outlier influence. If there are odd inputs (analyses), it takes the middle rank; if even, it takes the mean of the middle two.
        </li>
        <li style={{ marginBottom: 8 }}>
          <Chip color="#e8eefc" textColor="#2f4fb5">Median Rank Algorithm (MRA)</Chip>
          Iterative consensus aggregation: adjusts the ordering in cycles to find a final ranking that is mathematically closest to all input lists (aims to maximize Kendall rank similarity).
        </li>
        <li style={{ marginBottom: 8 }}>
          <Chip color="#e7f9ff" textColor="#0369a1">Minimum (Best) Rank</Chip>
          Uses the best (lowest) rank across analyses. Helpful if you want to keep biomarkers that rank very highly in at least one method.
        </li>
        <li style={{ marginBottom: 8 }}>
          <Chip color="#e7fbf6" textColor="#0f8a6a">Geometric Mean Rank</Chip>
          Uses the geometric mean of ranks; highlights consistently high-ranking features; less affected by a single extreme list.
        </li>
        <li style={{ marginBottom: 8 }}>
          <Chip color="#fff7ed" textColor="#9a3412">Stuart Rank Aggregation</Chip>
          Probabilistic order-statistics method: converts ranks to u = r/N, computes an order-statistics (Q/p-value) score under a random-ranking null model, and sorts features by ascending p-value (lowest is best).
        </li>
        <li style={{ marginBottom: 8 }}>
          <Chip color="#f0fdf4" textColor="#166534">Robust Rank Aggregation (RRA)</Chip>
          Probabilistic ensemble under a uniform null model. Robust to noise and missing ranks: a feature can score well if it ranks better-than-random in a significant subset of lists (poor/missing lists are effectively ignored). Sorted by ascending p-value (lowest is best).
        </li>
        <li style={{ marginBottom: 4 }}>
          <Chip color="#efe7ff" textColor="#5c2fb5">Reciprocal Rank Fusion (RRF)</Chip>
          Robust default. Rewards features that appear near the top across lists; parameter <b>k</b> controls how quickly lower ranks are discounted.
        </li>
      </ul>

      <div style={{ fontWeight: 700, marginTop: 12, marginBottom: 6 }}>Weight-based methods</div>
      <ul style={{ paddingLeft: 16, margin: 0, listStyle: 'none' }}>
        <li style={{ marginBottom: 4 }}>
          <Chip color="#eef2f7" textColor="#334155">Mean Weight</Chip>
          Normalizes each method’s continuous importance scores to 0-1, then averages them. Preserves magnitude (how strongly #1 beats #2). Sorted by descending consensus score (highest is best).
        </li>
        <li style={{ marginBottom: 4 }}>
          <Chip color="#fff3e1" textColor="#b55a00">Median Weight</Chip>
          Normalizes importance scores to 0-1, then takes the median across methods. More robust to outlier weights from one method. Sorted by descending consensus score.
        </li>
        <li style={{ marginBottom: 4 }}>
          <Chip color="#eaf2ff" textColor="#1d4ed8">Max Weight</Chip>
          Normalizes importance scores to 0-1, then takes the maximum across methods. Highlights biomarkers that are very strong in at least one method. Sorted by descending consensus score.
        </li>
        <li style={{ marginBottom: 4 }}>
          <Chip color="#e8eefc" textColor="#2f4fb5">Geometric Mean Weight</Chip>
          Normalizes importance scores to 0-1, then takes the geometric mean across methods. Rewards features that are consistently strong across methods and penalizes zeros/weak signals. Sorted by descending consensus score.
        </li>
        <li style={{ marginBottom: 4 }}>
          <Chip color="#e7fbf6" textColor="#0f8a6a">Threshold Algorithm (TA)</Chip>
          Efficient top-k selection using continuous (normalized) weights: scans the sorted method lists in parallel and stops early using a dynamic threshold that guarantees the top candidates cannot be beaten by unseen items. Outputs a consensus score and sorts descending.
        </li>
      </ul>

      <div style={{ marginTop: 10, background: '#f7fbff', border: '1px solid #e1efff', borderRadius: 8, padding: '8px 10px' }}>
        <div style={{ fontWeight: 700, color: '#2f4fb5', marginBottom: 4 }}>Example Usage</div>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>Start with <b>RRF</b> for a balanced choice.</li>
          <li>Use <b>Weighted Borda</b> to prioritize specific methods via weights.</li>
          <li>Compare Top-N lists across methods to check stability.</li>
        </ul>
      </div>
    </div>
  );
}
