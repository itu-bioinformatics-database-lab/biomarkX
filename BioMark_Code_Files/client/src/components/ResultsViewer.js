import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, buildUrl, apiFetch } from '../api';
import ImagePopup from './step8-1_ImagePopup';
import HelpTooltip from './common/HelpTooltip';
import { helpTexts } from '../content/helpTexts';

export default function ResultsViewer() {
  const { analysisId } = useParams();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('pending');
  const [images, setImages] = useState([]);
  const [error, setError] = useState('');
  const [plotGuideOpen, setPlotGuideOpen] = useState(false);
  const [linkExists, setLinkExists] = useState({});
  const [bestParams, setBestParams] = useState(null);
  const [bestParamsCsvUrl, setBestParamsCsvUrl] = useState(null);
  const [bestParamsCsvExists, setBestParamsCsvExists] = useState(false);
  const bestParamsCsvBlobUrl = useMemo(() => {
    try {
      if (!bestParams) return null;
      const rows = [['Model', 'Parameter', 'Value']];
      Object.entries(bestParams).forEach(([modelName, paramsObj]) => {
        if (paramsObj && typeof paramsObj === 'object') {
          Object.entries(paramsObj).forEach(([k, v]) => {
            const printable = Array.isArray(v) ? JSON.stringify(v) : String(v);
            rows.push([modelName, k, printable]);
          });
        }
      });
      const csv = rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      return URL.createObjectURL(blob);
    } catch (_) {
      return null;
    }
  }, [bestParams]);

  useEffect(() => {
    return () => {
      try { if (bestParamsCsvBlobUrl) URL.revokeObjectURL(bestParamsCsvBlobUrl); } catch (_) {}
    };
  }, [bestParamsCsvBlobUrl]);

  useEffect(() => {
    async function fetchAnalysis() {
      try {
        const res = await api.get(`/api/analyses/${analysisId}`);
        if (res.data && res.data.success) {
          setStatus(res.data.status || 'unknown');
          setImages(Array.isArray(res.data.resultImages) ? res.data.resultImages : []);
          // Use bestParams from API if present, otherwise try reading the file
          if (res.data.bestParams && typeof res.data.bestParams === 'object') {
            setBestParams(res.data.bestParams);
          } else {
            try {
              const paths = Array.isArray(res.data.resultImages) ? res.data.resultImages : [];
              const first = paths && paths.length > 0 ? paths[0] : null;
              if (first) {
                const parts = first.split('/');
                const idx = parts.indexOf('results');
                if (idx >= 0 && parts.length >= idx + 3) {
                  const basePath = `/results/${parts[idx + 1]}/${parts[idx + 2]}/best_params.json`;
                  const resp = await apiFetch(buildUrl(basePath));
                  if (resp.ok) {
                    const json = await resp.json();
                    if (json && typeof json === 'object') setBestParams(json);
                  }
                }
              }
            } catch (e) {
              // ignore missing best_params.json
            }
          }
        } else {
          setError(res.data?.message || 'Failed to fetch analysis');
        }
      } catch (e) {
        setError(e.response?.data?.message || e.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchAnalysis();
  }, [analysisId]);

  // Compute Best Params CSV URL from first result image path and check availability
  useEffect(() => {
    (async () => {
      try {
        if (!Array.isArray(images) || images.length === 0) return;
        const first = images[0];
        const parts = first.split('/');
        const idx = parts.indexOf('results');
        if (idx >= 0 && parts.length >= idx + 3) {
          const url = buildUrl(`/results/${parts[idx + 1]}/${parts[idx + 2]}/best_params.csv`);
          setBestParamsCsvUrl(url);
          try {
            const res = await apiFetch(url, { method: 'HEAD' });
            setBestParamsCsvExists(res.ok === true);
          } catch (_) {
            setBestParamsCsvExists(false);
          }
        }
      } catch (_) {
        // noop
      }
    })();
  }, [images]);

  const prettyStatus = useMemo(() => {
    const s = (status || '').toLowerCase();
    if (s === 'finished') return { text: 'Finished', className: 'status-finished' };
    if (s === 'running') return { text: 'Running', className: 'status-running' };
    if (s === 'failed') return { text: 'Failed', className: 'status-failed' };
    return { text: s || 'Unknown', className: 'status-unknown' };
  }, [status]);

  const buildCaptionAndHelp = (imagePath) => {
    const raw = imagePath.split('/').pop() || '';
    let name = raw.replace(/_/g, ' ').replace('.png', '');
    name = name
      .replace(/\bresults\b/i, 'Results')
      .replace(/Model Evaluation Results -\s*/i, '')
      .replace(/Classification Results -\s*/i, '')
      .replace(/Clustering Results -\s*/i, '')
      .replace(/Analysis Results -\s*/i, '')
      .replace(/Performance Results -\s*/i, '')
      .replace(/Differential Analysis -\s*/i, '')
      .trim();

    const lower = imagePath.toLowerCase();
    let contextualHelp = null;
    if (lower.includes('logrank')) {
      contextualHelp = 'Log-rank test compares survival distributions between groups. Bars show -log10(p-value); values beyond the red dashed line (p < 0.05) indicate statistically significant differences in survival.';
    } else if (lower.includes('km_survival') || lower.includes('kaplan')) {
      contextualHelp = 'Kaplan-Meier survival curves show the estimated survival probability over time for each group. Shaded bands represent confidence intervals. A steeper drop indicates faster event occurrence.';
    } else if (lower.includes('cox_forest') || lower.includes('cox_multivariate')) {
      contextualHelp = 'Cox regression forest plot shows hazard ratios for each feature. HR > 1 indicates higher risk; HR < 1 indicates a protective effect. Error bars show 95% confidence intervals. Red bars are statistically significant (p < 0.05).';
    } else if (lower.includes('results.png')) {
      contextualHelp = 'Performance table: Rows indicate Cross-Validation, Train and Test sets; columns show metrics (Accuracy, Precision, Recall, F1, ROC-AUC) and Support.';
    } else if (lower.includes('pca')) {
      contextualHelp = helpTexts?.results?.dimReduction?.pca;
    } else if (lower.includes('tsne')) {
      contextualHelp = helpTexts?.results?.dimReduction?.tsne;
    } else if (lower.includes('umap')) {
      contextualHelp = helpTexts?.results?.dimReduction?.umap;
    } else if (lower.includes('heatmap')) {
      contextualHelp = helpTexts?.results?.statistical?.heatmap;
    } else if (lower.includes('volcano')) {
      contextualHelp = helpTexts?.results?.statistical?.volcano;
    } else if (lower.includes('box') || lower.includes('violin')) {
      contextualHelp = helpTexts?.results?.statistical?.box;
    } else if ((lower.includes('top') && lower.includes('feature')) || lower.includes('bar')) {
      contextualHelp = helpTexts?.results?.statistical?.topbars;
    }

    const isAfterFeatureSelection = imagePath.includes('AfterFeatureSelection') || imagePath.includes('afterFeatureSelection');
    if (isAfterFeatureSelection) {
      name = `${name} (Selected Features)`;
    } else if (imagePath.includes('initial')) {
      name = `${name} (All Features)`;
    }

    return { caption: name, contextualHelp };
  };

  const buildDownloadLinks = (imagePath) => {
    try {
      const links = [];
      const parts = (imagePath || '').split('/');
      const idxRes = parts.indexOf('results');
      if (idxRes === -1) return links;
      const fileName = parts[idxRes + 1];
      const classPair = parts[idxRes + 2];

      // Optional phase between classPair and method (e.g., 'initial', 'AfterFeatureSelection')
      const afterPair = parts.slice(idxRes + 3);
      const methodKeys = new Set(['t_test', 'anova', 'wilcoxon_rank_sum', 'kruskal_wallis', 'shap', 'lime', 'feature_importance', 'models', 'summaryStatisticalMethods', 'kaplan_meier', 'cox_regression']);
      const foundIdx = afterPair.findIndex(seg => methodKeys.has(seg));
      const phase = foundIdx > 0 ? afterPair.slice(0, foundIdx).join('/') : (foundIdx === 0 ? '' : afterPair.slice(0, 1).join('/'));
      const sub1 = foundIdx >= 0 ? afterPair[foundIdx] : afterPair[0];

      const basePrefix = `/results/${fileName}/${classPair}` + (phase ? `/${phase}` : '');

      // Statistical: t_test / anova / wilcoxon_rank_sum / kruskal_wallis
      if (sub1 === 't_test') {
        links.push({ href: buildUrl(`${basePrefix}/t_test/t_test_results.csv`), label: 'Download Model Details as CSV' });
        // Aggregated (combined) ranking for the class pair
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/ranked_features_df.csv`), label: 'Download Biomarker List (Combined)' });
        // Method-specific ranked list for t_test only
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/method=statistical_tests_analysis=t_test/ranked_features_df.csv`), label: 'Download Biomarker List as CSV' });
        return links;
      }
      if (sub1 === 'anova') {
        links.push({ href: buildUrl(`${basePrefix}/anova/anova_results.csv`), label: 'Download Model Details as CSV' });
        // Aggregated (combined) ranking for the class pair
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/ranked_features_df.csv`), label: 'Download Biomarker List (Combined)' });
        // Method-specific ranked list for anova only
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/method=statistical_tests_analysis=anova/ranked_features_df.csv`), label: 'Download Biomarker List as CSV' });
        return links;
      }
      if (sub1 === 'wilcoxon_rank_sum') {
        links.push({ href: buildUrl(`${basePrefix}/wilcoxon_rank_sum/wilcoxon_rank_sum_results.csv`), label: 'Download Model Details as CSV' });
        // Aggregated (combined) ranking for the class pair
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/ranked_features_df.csv`), label: 'Download Biomarker List (Combined)' });
        // Method-specific ranked list for wilcoxon_rank_sum only
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/method=statistical_tests_analysis=wilcoxon_rank_sum/ranked_features_df.csv`), label: 'Download Biomarker List as CSV' });
        return links;
      }
      if (sub1 === 'kruskal_wallis') {
        links.push({ href: buildUrl(`${basePrefix}/kruskal_wallis/kruskal_wallis_results.csv`), label: 'Download Model Details as CSV' });
        // Aggregated (combined) ranking for the class pair
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/ranked_features_df.csv`), label: 'Download Biomarker List (Combined)' });
        // Method-specific ranked list for kruskal_wallis only
        links.push({ href: buildUrl(`/results/${fileName}/feature_ranking/${classPair}/method=statistical_tests_analysis=kruskal_wallis/ranked_features_df.csv`), label: 'Download Biomarker List as CSV' });
        return links;
      }

      // Model Explanation: SHAP / LIME
      if (sub1 === 'shap') {
        const raw = (imagePath.split('/').pop() || '').toLowerCase();
        // Show only on a canonical SHAP image to avoid duplicates
        if (raw.includes('mean_shap_plot_overall')) {
          links.push({ href: buildUrl(`${basePrefix}/shap/shap_feature_importance.csv`), label: 'Download Model Details as CSV' });
        }
        return links;
      }
      if (sub1 === 'lime') {
        const raw = (imagePath.split('/').pop() || '').toLowerCase();
        // Show only on LIME summary image to avoid duplicates
        if (raw.includes('lime_summary_plot')) {
          links.push({ href: buildUrl(`${basePrefix}/lime/lime_feature_importance.csv`), label: 'Download Model Details as CSV' });
        }
        return links;
      }

      // Feature importance (Permutation and built-ins)
      if (sub1 === 'feature_importance') {
        const basePath = `${basePrefix}/feature_importance`;

        const rawName = (imagePath.split('/').pop() || '').toLowerCase();
        if (rawName.includes('permutation_features_plot')) {
          links.push({ href: buildUrl(`${basePath}/permutation_feature_importance_summary.csv`), label: 'Download Summary CSV' });
          links.push({ href: buildUrl(`${basePath}/permutation_feature_importance_matrix.csv`), label: 'Download Matrix CSV' });
        } else {
          // Built-in model FI plots: <ModelName>_feature_importance.png
          const modelFile = (imagePath.split('/').pop() || '').replace('_feature_importance.png', '');
          const csvPath = `${basePath}/${modelFile}_feature_importance.csv`;
          links.push({ href: buildUrl(csvPath), label: 'Download Model Details as CSV' });
        }
        return links;
      }

      // Classification model results tables
      if (sub1 === 'models') {
        const modelName = parts[idxRes + 4] && !methodKeys.has(parts[idxRes + 4]) ? parts[idxRes + 4] : parts[idxRes + 5];
        if (fileName && classPair && modelName) {
          links.push({ href: buildUrl(`${basePrefix}/models/${modelName}/${modelName}_results.csv`), label: 'Download Model Details as CSV' });
          links.push({ href: buildUrl(`${basePrefix}/models/${modelName}/${modelName}_cv_folds.csv`), label: 'Download CV CSV' });
        }
        return links;
      }

      // Survival: Kaplan-Meier
      if (sub1 === 'kaplan_meier') {
        links.push({ href: buildUrl(`${basePrefix}/kaplan_meier/km_summary.csv`), label: 'Download KM Summary CSV' });
        links.push({ href: buildUrl(`${basePrefix}/kaplan_meier/logrank_test_results.csv`), label: 'Download Log-Rank Results CSV' });
        return links;
      }
      // Survival: Cox Regression
      if (sub1 === 'cox_regression') {
        links.push({ href: buildUrl(`${basePrefix}/cox_regression/cox_regression_results.csv`), label: 'Download Cox Results CSV' });
        links.push({ href: buildUrl(`${basePrefix}/cox_regression/cox_multivariate_results.csv`), label: 'Download Multivariate Cox CSV' });
        return links;
      }

      return links;
    } catch (e) {
      return [];
    }
  };

  // Check existence of candidate download links and cache results
  useEffect(() => {
    async function checkAllLinks() {
      try {
        const candidates = new Set();
        images.forEach((p) => {
          const links = buildDownloadLinks(p);
          links.forEach((l) => {
            if (!linkExists.hasOwnProperty(l.href)) candidates.add(l.href);
          });
        });
        if (candidates.size === 0) return;
        const results = {};
        await Promise.all(
          Array.from(candidates).map(async (url) => {
            try {
              const res = await apiFetch(url, { method: 'HEAD' });
              results[url] = res.ok === true;
            } catch (e) {
              results[url] = false;
            }
          })
        );
        setLinkExists((prev) => ({ ...prev, ...results }));
      } catch (e) {
        // ignore
      }
    }
    if (Array.isArray(images) && images.length > 0) {
      checkAllLinks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  if (loading) return <div style={{ padding: 20 }}>Loading results...</div>;
  if (error) return <div style={{ padding: 20, color: 'crimson' }}>{error}</div>;

  return (
    <div style={{ padding: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12
      }}>
        <h2 style={{ margin: 0 }}>Analysis Results</h2>
        <div>
          <span className={`status-pill ${prettyStatus.className}`} style={{
            padding: '4px 10px', borderRadius: '999px', fontSize: 12, fontWeight: 700
          }}>
            {prettyStatus.text}
          </span>
        </div>
      </div>

      <div style={{ margin: '6px 0 14px 0', color: '#59607a' }}>
        <Link to="/" style={{ textDecoration: 'none' }}>&larr; Back to Tool</Link>
      </div>

      {/* Plot guide toggle */}
      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', margin: '8px 0 8px 0' }}>
        <button
          onClick={() => setPlotGuideOpen(prev => !prev)}
          className="plot-guide-button"
          style={{
            padding: '6px 14px', borderRadius: '999px', background: '#eef3fd', color: '#2f4fb5',
            border: '1px solid #d7e2ff', fontWeight: 700, letterSpacing: '0.2px', cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
          }}
        >
          Plot guide
        </button>
      </div>
      {plotGuideOpen && (
        <div style={{
          width: '100%', maxWidth: '980px', margin: '0 auto 12px auto',
          background: '#ffffff', border: '1px solid #e6e9f2', borderRadius: '10px',
          boxShadow: '0 6px 18px rgba(0,0,0,0.06)', padding: '14px 16px'
        }}>
          {/* Classification */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#2b365a', marginBottom: '6px' }}>Classification</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <HelpTooltip placement="right" text={helpTexts.results.general.classificationTable}>Performance Table</HelpTooltip>
            </div>
          </div>
          {/* Statistical Tests */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#2b365a', marginBottom: '6px' }}>Statistical Tests</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <HelpTooltip placement="right" text={helpTexts.results.statistical.topbars}>Top-N Features (Bar)</HelpTooltip>
            </div>
          </div>
          {/* Dimensionality Reduction */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#2b365a', marginBottom: '6px' }}>Dimensionality Reduction</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <HelpTooltip placement="right" text={helpTexts.results.dimReduction.pca}>PCA</HelpTooltip>
              <HelpTooltip placement="right" text={helpTexts.results.dimReduction.tsne}>t-SNE</HelpTooltip>
              <HelpTooltip placement="right" text={helpTexts.results.dimReduction.umap}>UMAP</HelpTooltip>
            </div>
          </div>
          {/* Model Explanation */}
          <div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#2b365a', marginBottom: '6px' }}>Model Explanation</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <HelpTooltip placement="right" text={helpTexts.results.explanation?.shapSummary || 'Each dot is a sample; color shows feature value; left/right moves prediction down/up.'}>SHAP Summary</HelpTooltip>
              <HelpTooltip placement="right" text={helpTexts.results.explanation?.shapHeatmap || 'Samples vs. features; color encodes SHAP value (impact).'}>SHAP Heatmap</HelpTooltip>
              <HelpTooltip placement="right" text={helpTexts.results.explanation?.shapWaterfall || 'Base value to final prediction with per-feature pushes (red up, blue down).'}>SHAP Waterfall</HelpTooltip>
              <HelpTooltip placement="right" text={helpTexts.results.explanation?.shapForce || 'How features push a single prediction higher or lower.'}>SHAP Force</HelpTooltip>
              <HelpTooltip placement="right" text={helpTexts.results.explanation?.limeLocal || 'Linear explanation for one sample; positive/negative weights show direction/strength.'}>LIME Local</HelpTooltip>
              <HelpTooltip placement="right" text={helpTexts.results.explanation?.permutationImportance || 'Drop in score when a feature is shuffled; larger drop = more important.'}>Permutation Importance</HelpTooltip>
            </div>
          </div>
        </div>
      )}

      {bestParams && (
        <div style={{ width: '100%', margin: '10px 0', textAlign: 'center' }}>
          <h3>Optimized Hyperparameters (GridSearchCV)</h3>
          {Object.entries(bestParams).map(([modelName, paramsObj]) => (
            <div key={modelName} style={{ margin: '10px auto', maxWidth: '900px' }}>
              <h4 style={{ margin: '8px 0' }}>{modelName}</h4>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                background: '#fff',
                border: '1px solid #e0e0e0'
              }}>
                <thead>
                  <tr style={{ background: '#f5f7fb' }}>
                    <th style={{ border: '1px solid #e0e0e0', padding: '6px 8px', textAlign: 'left' }}>Parameter</th>
                    <th style={{ border: '1px solid #e0e0e0', padding: '6px 8px', textAlign: 'left' }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(paramsObj).map(([pKey, pVal]) => (
                    <tr key={pKey}>
                      <td style={{ border: '1px solid #e0e0e0', padding: '6px 8px' }}>{pKey}</td>
                      <td style={{ border: '1px solid #e0e0e0', padding: '6px 8px' }}>{String(pVal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {(bestParamsCsvUrl && bestParamsCsvExists) ? (
            <div style={{ marginTop: 10 }}>
              <a href={bestParamsCsvUrl} download style={{ padding: '6px 10px', border: '1px solid #d7e2ff', borderRadius: 6, background: '#eef3fd', color: '#2f4fb5', fontWeight: 700 }}>
                Download Best Params CSV
              </a>
            </div>
          ) : (bestParamsCsvBlobUrl ? (
            <div style={{ marginTop: 10 }}>
              <a href={bestParamsCsvBlobUrl} download="best_params.csv" style={{ padding: '6px 10px', border: '1px solid #d7e2ff', borderRadius: 6, background: '#eef3fd', color: '#2f4fb5', fontWeight: 700 }}>
                Download Best Params CSV
              </a>
            </div>
          ) : null)}
        </div>
      )}

      {images.length === 0 ? (
        <div>No images found.</div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 14
        }}>
          {images.map((p, idx) => {
            const { caption, contextualHelp } = buildCaptionAndHelp(p);
            const downloadLinks = buildDownloadLinks(p);
            return (
              <div key={idx} style={{
                background: '#fff',
                border: '1px solid #e6e9f2',
                borderRadius: 10,
                boxShadow: '0 6px 18px rgba(0,0,0,0.06)',
                padding: 10,
                position: 'relative'
              }}>
                {contextualHelp && (
                  <div style={{ position: 'absolute', top: 10, right: 10 }}>
                    <HelpTooltip text={contextualHelp}>info</HelpTooltip>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <ImagePopup imagePath={buildUrl(`/${p}`)} imageName={caption} />
                </div>
                <div style={{
                  fontSize: 13, color: '#2b365a',
                  marginTop: 8, textAlign: 'center', fontWeight: 600
                }}>
                  {caption}
                </div>

                {downloadLinks.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                    {downloadLinks
                      .filter((l) => linkExists[l.href] === true)
                      .map((l, i) => (
                        <a key={i} href={l.href} download style={{ padding: '6px 10px', border: '1px solid #d7e2ff', borderRadius: 6, background: '#eef3fd', color: '#2f4fb5', fontWeight: 700 }}>
                          {l.label}
                        </a>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


