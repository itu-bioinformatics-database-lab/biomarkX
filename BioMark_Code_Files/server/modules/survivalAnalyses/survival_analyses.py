# Survival Analysis Module
# Implements Kaplan-Meier estimator and Cox Proportional Hazards regression.

import os
import json
import warnings
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
import warnings

from lifelines import KaplanMeierFitter, CoxPHFitter
from lifelines.statistics import logrank_test
from sklearn.preprocessing import LabelEncoder

from modules.logger import logging
from modules.feature_selection import feature_rank


class SurvivalAnalysis:
    """
    Survival analysis runner for Kaplan-Meier and Cox Regression.
    Follows the same architectural pattern as StatisticalTestAnalysis.

    Parameters
    ----------
    data : pd.DataFrame
        Full dataset including time, event, group and feature columns.
    time_column : str
        Name of the column holding the survival/follow-up time.
    event_column : str
        Name of the column holding the event indicator (1 = event, 0 = censored).
    labels_column : str
        Name of the group/illness column used for stratifying KM curves.
    sample_id_column : str
        Sample identifier column (will be dropped before modelling).
    outdir : str
        Root output directory for this class-pair run.
    analyses : list[str]
        Which analyses to run, e.g. ['kaplan_meier', 'cox_regression'].
    confidence_level : float
        Confidence interval width for KM curves (default 0.95).
    cox_penalizer : float
        L2 penalizer for CoxPH (default 0.0).
    cox_tie_method : str
        Tie-handling method for CoxPH ('efron' or 'breslow').
    top_features_to_plot : int
        Number of top features to show in the Cox forest plot.
    """

    def __init__(
        self,
        data,
        time_column,
        event_column,
        labels_column="Diagnosis",
        sample_id_column="Sample ID",
        outdir="output",
        analyses=None,
        confidence_level=0.95,
        cox_penalizer=0.0,
        cox_tie_method="efron",
        top_features_to_plot=20,
    ):
        sns.set_theme(style="darkgrid")

        self.data = data.copy()
        self.time_column = time_column
        self.event_column = event_column
        self.labels_column = labels_column
        self.sample_id_column = sample_id_column
        self.outdir = outdir
        self.analyses = analyses or ["kaplan_meier"]
        self.confidence_level = confidence_level
        self.cox_penalizer = cox_penalizer
        self.cox_tie_method = cox_tie_method
        self.top_features_to_plot = top_features_to_plot

        # Validate required columns exist
        for col_name, col_val in [("time_column", time_column),
                                   ("event_column", event_column)]:
            if col_val not in self.data.columns:
                raise ValueError(f"Column '{col_val}' ({col_name}) not found in dataset. "
                                 f"Available: {list(self.data.columns)}")

        # Coerce time and event columns to numeric
        self.data[self.time_column] = pd.to_numeric(self.data[self.time_column], errors='coerce')
        self.data[self.event_column] = pd.to_numeric(self.data[self.event_column], errors='coerce')

        # Drop rows where time or event is NaN
        before = len(self.data)
        self.data = self.data.dropna(subset=[self.time_column, self.event_column])
        after = len(self.data)
        if before != after:
            print(f"WARNING: Dropped {before - after} rows with missing time/event values.")

        # Ensure event column is binary (0/1)
        unique_events = sorted(self.data[self.event_column].unique())
        if not set(unique_events).issubset({0, 1, 0.0, 1.0}):
            print(f"WARNING: Event column has values {unique_events}. Binarizing: max value -> 1, rest -> 0.")
            max_val = self.data[self.event_column].max()
            self.data[self.event_column] = (self.data[self.event_column] == max_val).astype(int)

        # Create output directories
        for analysis in self.analyses:
            for fmt in ["png", "pdf"]:
                os.makedirs(os.path.join(self.outdir, analysis, fmt), exist_ok=True)

        # Class names for stratified KM
        if self.labels_column in self.data.columns:
            self.class_names = sorted(self.data[self.labels_column].dropna().unique().tolist(), key=str)
        else:
            self.class_names = []

    def _save_cox_ranking_outputs(self, results_df):
        """Persist Cox feature scores for the shared ranking pipeline."""
        if results_df is None or results_df.empty:
            return

        # Convert Cox p-values to a higher-is-better importance score for rank fusion.
        cox_scores = {}
        for _, row in results_df.iterrows():
            feature_name = str(row.get("Feature", "")).strip()
            if not feature_name:
                continue
            p_val = pd.to_numeric(row.get("p_value"), errors="coerce")
            if pd.isna(p_val):
                continue
            bounded_p = float(max(min(p_val, 1.0), 1e-300))
            cox_scores[feature_name] = float(-np.log10(bounded_p))

        if not cox_scores:
            return

        base_outdir = os.path.dirname(self.outdir)
        json_path = os.path.join(base_outdir, "feature_importances.json")

        if os.path.exists(json_path):
            with open(json_path, "r", encoding="utf-8") as f:
                try:
                    existing_data = json.load(f)
                except json.JSONDecodeError:
                    existing_data = {}
        else:
            existing_data = {}

        class_pair = "_vs_".join(sorted(str(c) for c in self.class_names)) if len(self.class_names) >= 2 else "all_classes"
        if class_pair not in existing_data:
            existing_data[class_pair] = {}

        existing_data[class_pair]["cox_regression"] = {
            feature: float(score) for feature, score in cox_scores.items()
        }

        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(existing_data, f, indent=4)

        # Also generate method-specific ranking CSV so Cox appears alongside other analyses.
        filtered_for_ranking = {
            class_pair: {
                "cox_regression": cox_scores,
            }
        }
        feature_rank(
            top_features=filtered_for_ranking,
            num_top_features=self.top_features_to_plot,
            feature_type="microRNA",
            outdir=base_outdir,
            subdir_label="method=survival_analysis,analysis=cox_regression",
        )

    # ------------------------------------------------------------------
    # Kaplan-Meier
    # ------------------------------------------------------------------
    def perform_kaplan_meier(self):
        logging.info("Performing Kaplan-Meier Analysis")
        length = 110
        print("=" * length)
        print(" Starting Kaplan-Meier Survival Analysis")
        print("=" * length)

        km_dir = os.path.join(self.outdir, "kaplan_meier")

        # --- 1. Stratified KM curves (one curve per class) ---
        if self.labels_column in self.data.columns and len(self.class_names) >= 2:
            fig, ax = plt.subplots(figsize=(10, 7))
            colors = sns.color_palette("Set2", len(self.class_names))

            km_results = []

            for idx, cls in enumerate(self.class_names):
                mask = self.data[self.labels_column] == cls
                subset = self.data[mask]
                if len(subset) == 0:
                    continue
                kmf = KaplanMeierFitter()
                kmf.fit(
                    subset[self.time_column],
                    event_observed=subset[self.event_column],
                    label=str(cls),
                    alpha=1 - self.confidence_level,
                )
                kmf.plot_survival_function(ax=ax, ci_show=True, color=colors[idx % len(colors)])

                km_results.append({
                    "Group": str(cls),
                    "N": int(len(subset)),
                    "Events": int(subset[self.event_column].sum()),
                    "Median_Survival": float(kmf.median_survival_time_) if np.isfinite(kmf.median_survival_time_) else None,
                })

            ax.set_title("Kaplan-Meier Survival Curves by Group", fontsize=16)
            ax.set_xlabel("Time", fontsize=14)
            ax.set_ylabel("Survival Probability", fontsize=14)
            ax.legend(fontsize=12)
            ax.grid(True, alpha=0.3)

            png_path = os.path.join(km_dir, "png", "km_survival_curves.png")
            pdf_path = os.path.join(km_dir, "pdf", "km_survival_curves.pdf")
            fig.savefig(png_path, bbox_inches='tight', dpi=150)
            fig.savefig(pdf_path, bbox_inches='tight')
            plt.close(fig)
            print(png_path)

            # Save summary CSV
            if km_results:
                km_df = pd.DataFrame(km_results)
                csv_path = os.path.join(km_dir, "km_summary.csv")
                km_df.to_csv(csv_path, index=False, sep=";", encoding="utf-8-sig")

            # --- 2. Log-rank test (pairwise if >2 classes) ---
            logrank_rows = []
            if len(self.class_names) == 2:
                g1 = self.data[self.data[self.labels_column] == self.class_names[0]]
                g2 = self.data[self.data[self.labels_column] == self.class_names[1]]
                result = logrank_test(
                    g1[self.time_column], g2[self.time_column],
                    event_observed_A=g1[self.event_column],
                    event_observed_B=g2[self.event_column],
                )
                logrank_rows.append({
                    "Group_1": str(self.class_names[0]),
                    "Group_2": str(self.class_names[1]),
                    "Test_Statistic": float(result.test_statistic),
                    "p_value": float(result.p_value),
                })
            elif len(self.class_names) > 2:
                for i in range(len(self.class_names)):
                    for j in range(i + 1, len(self.class_names)):
                        g1 = self.data[self.data[self.labels_column] == self.class_names[i]]
                        g2 = self.data[self.data[self.labels_column] == self.class_names[j]]
                        if len(g1) == 0 or len(g2) == 0:
                            continue
                        result = logrank_test(
                            g1[self.time_column], g2[self.time_column],
                            event_observed_A=g1[self.event_column],
                            event_observed_B=g2[self.event_column],
                        )
                        logrank_rows.append({
                            "Group_1": str(self.class_names[i]),
                            "Group_2": str(self.class_names[j]),
                            "Test_Statistic": float(result.test_statistic),
                            "p_value": float(result.p_value),
                        })

            if logrank_rows:
                lr_df = pd.DataFrame(logrank_rows)
                lr_csv = os.path.join(km_dir, "logrank_test_results.csv")
                lr_df.to_csv(lr_csv, index=False, sep=";", encoding="utf-8-sig")

                # Plot log-rank p-values as a bar chart
                fig2, ax2 = plt.subplots(figsize=(10, max(4, len(logrank_rows) * 0.6)))
                pair_labels = [f"{r['Group_1']} vs {r['Group_2']}" for r in logrank_rows]
                p_values = [r["p_value"] for r in logrank_rows]
                bar_colors = ["#e74c3c" if p < 0.05 else "#3498db" for p in p_values]

                ax2.barh(pair_labels, [-np.log10(max(p, 1e-300)) for p in p_values], color=bar_colors)
                ax2.axvline(x=-np.log10(0.05), color="red", linestyle="--", label="p = 0.05")
                ax2.set_xlabel("-log10(p-value)", fontsize=14)
                ax2.set_title("Log-Rank Test Results", fontsize=16)
                ax2.legend(fontsize=11)
                ax2.invert_yaxis()

                png_lr = os.path.join(km_dir, "png", "logrank_test_results.png")
                pdf_lr = os.path.join(km_dir, "pdf", "logrank_test_results.pdf")
                fig2.savefig(png_lr, bbox_inches='tight', dpi=150)
                fig2.savefig(pdf_lr, bbox_inches='tight')
                plt.close(fig2)
                print(png_lr)

        else:
            # Single group: just plot overall KM curve
            fig, ax = plt.subplots(figsize=(10, 7))
            kmf = KaplanMeierFitter()
            kmf.fit(
                self.data[self.time_column],
                event_observed=self.data[self.event_column],
                label="Overall",
                alpha=1 - self.confidence_level,
            )
            kmf.plot_survival_function(ax=ax, ci_show=True)
            ax.set_title("Kaplan-Meier Survival Curve (Overall)", fontsize=16)
            ax.set_xlabel("Time", fontsize=14)
            ax.set_ylabel("Survival Probability", fontsize=14)
            ax.grid(True, alpha=0.3)

            png_path = os.path.join(km_dir, "png", "km_survival_curves.png")
            pdf_path = os.path.join(km_dir, "pdf", "km_survival_curves.pdf")
            fig.savefig(png_path, bbox_inches='tight', dpi=150)
            fig.savefig(pdf_path, bbox_inches='tight')
            plt.close(fig)
            print(png_path)

        print("=" * length)
        print(" Kaplan-Meier Analysis Completed ")
        print("=" * length)

    # ------------------------------------------------------------------
    # Cox Proportional Hazards Regression
    # ------------------------------------------------------------------
    def perform_cox_regression(self):
        logging.info("Performing Cox Regression Analysis")
        length = 110
        print("=" * length)
        print(" Starting Cox Proportional Hazards Regression")
        print("=" * length)

        cox_dir = os.path.join(self.outdir, "cox_regression")

        # Build modelling dataframe: time, event + numeric features
        drop_cols = []
        if self.sample_id_column in self.data.columns:
            drop_cols.append(self.sample_id_column)
        # Never model the selected illness/group column as a predictor.
        if self.labels_column in self.data.columns and self.labels_column not in [self.time_column, self.event_column]:
            drop_cols.append(self.labels_column)

        model_data = self.data.drop(columns=drop_cols, errors='ignore').copy()

        # Convert remaining object columns to numeric or encode
        for col in model_data.columns:
            if col in [self.time_column, self.event_column]:
                continue
            if model_data[col].dtype == object or model_data[col].dtype.name == 'category':
                coerced = pd.to_numeric(model_data[col], errors='coerce')
                if coerced.notna().sum() > len(model_data) * 0.5:
                    model_data[col] = coerced.fillna(coerced.median())
                else:
                    le = LabelEncoder()
                    model_data[col] = le.fit_transform(model_data[col].astype(str))

        # Drop columns with zero variance (CoxPH will fail on them)
        numeric_cols = model_data.select_dtypes(include=[np.number]).columns.tolist()
        zero_var = [c for c in numeric_cols if c not in [self.time_column, self.event_column]
                    and model_data[c].std() == 0]
        if zero_var:
            print(f"Dropping {len(zero_var)} zero-variance columns: {zero_var[:10]}...")
            model_data = model_data.drop(columns=zero_var)

        # Fill any remaining NaN with median
        model_data = model_data.fillna(model_data.median(numeric_only=True))

        # Feature columns (everything except time and event)
        feature_cols = [c for c in model_data.columns
                        if c not in [self.time_column, self.event_column, self.sample_id_column, self.labels_column]]

        if not feature_cols:
            print("ERROR: No feature columns available for Cox regression.")
            print("=" * length)
            return

        # --- Univariate Cox regression per feature ---
        univariate_results = []
        for feat in feature_cols:
            try:
                cph = CoxPHFitter(penalizer=self.cox_penalizer)
                subset = model_data[[self.time_column, self.event_column, feat]].dropna()
                if len(subset) < 5 or subset[feat].std() == 0:
                    continue
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    cph.fit(subset, duration_col=self.time_column, event_col=self.event_column)
                summary = cph.summary
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    univariate_results.append({
                        "Feature": feat,
                        "Hazard_Ratio": float(np.exp(summary["coef"].iloc[0])),
                        "coef": float(summary["coef"].iloc[0]),
                        "se(coef)": float(summary["se(coef)"].iloc[0]),
                        "z": float(summary["z"].iloc[0]),
                        "p_value": float(summary["p"].iloc[0]),
                        "lower_CI": float(np.exp(summary["coef lower 95%"].iloc[0])),
                        "upper_CI": float(np.exp(summary["coef upper 95%"].iloc[0])),
                        "concordance": float(cph.concordance_index_),
                    })
            except Exception as e:
                print(f"  Skipping feature '{feat}': {e}")

        if not univariate_results:
            print("ERROR: No features could be fit with Cox regression.")
            print("=" * length)
            return

        results_df = pd.DataFrame(univariate_results)
        results_df = results_df.sort_values("p_value").reset_index(drop=True)

        # Save full results CSV
        csv_path = os.path.join(cox_dir, "cox_regression_results.csv")
        results_df.to_csv(csv_path, index=False, sep=";", encoding="utf-8-sig")

        try:
            self._save_cox_ranking_outputs(results_df)
        except Exception as e:
            print(f"WARNING: Failed to save Cox ranking outputs: {e}")

        # --- Forest plot of top features ---
        top_n = results_df.head(self.top_features_to_plot).copy()
        top_n = top_n.iloc[::-1]  # flip for horizontal bar

        fig, ax = plt.subplots(figsize=(10, max(6, len(top_n) * 0.5)))
        y_pos = range(len(top_n))

        colors = ["#e74c3c" if p < 0.05 else "#3498db" for p in top_n["p_value"]]
        ax.barh(y_pos, top_n["Hazard_Ratio"], color=colors, height=0.6, alpha=0.8)

        # Error bars (CI)
        for i, (_, row) in enumerate(top_n.iterrows()):
            ax.plot(
                [row["lower_CI"], row["upper_CI"]],
                [i, i],
                color="black",
                linewidth=1.2,
            )

        ax.axvline(x=1.0, color="black", linestyle="--", linewidth=0.8)
        ax.set_yticks(list(y_pos))
        ax.set_yticklabels(top_n["Feature"], fontsize=11)
        ax.set_xlabel("Hazard Ratio", fontsize=14)
        ax.set_title(f"Cox Regression - Top {len(top_n)} Features (Forest Plot)", fontsize=15)

        # Add p-value annotations
        for i, (_, row) in enumerate(top_n.iterrows()):
            p_str = f"p={row['p_value']:.2e}" if row['p_value'] < 0.001 else f"p={row['p_value']:.4f}"
            ax.text(
                max(row["upper_CI"], row["Hazard_Ratio"]) * 1.02,
                i,
                p_str,
                va="center",
                fontsize=9,
                color="#555",
            )

        plt.tight_layout()
        png_path = os.path.join(cox_dir, "png", "cox_forest_plot.png")
        pdf_path = os.path.join(cox_dir, "pdf", "cox_forest_plot.pdf")
        fig.savefig(png_path, bbox_inches='tight', dpi=150)
        fig.savefig(pdf_path, bbox_inches='tight')
        plt.close(fig)
        print(png_path)

        # --- Multivariate Cox with significant features ---
        sig_features = results_df[results_df["p_value"] < 0.05]["Feature"].tolist()
        if sig_features:
            try:
                mv_cols = [self.time_column, self.event_column] + sig_features[:self.top_features_to_plot]
                mv_data = model_data[mv_cols].dropna()

                cph_multi = CoxPHFitter(penalizer=self.cox_penalizer)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    cph_multi.fit(mv_data, duration_col=self.time_column, event_col=self.event_column)

                mv_summary = cph_multi.summary.copy()
                mv_summary["Hazard_Ratio"] = np.exp(mv_summary["coef"])
                mv_csv = os.path.join(cox_dir, "cox_multivariate_results.csv")
                mv_summary.to_csv(mv_csv, sep=";", encoding="utf-8-sig")

                # Multivariate forest plot
                mv_plot = mv_summary.sort_values("p").head(self.top_features_to_plot).iloc[::-1]
                fig3, ax3 = plt.subplots(figsize=(10, max(6, len(mv_plot) * 0.5)))

                mv_colors = ["#e74c3c" if p < 0.05 else "#3498db" for p in mv_plot["p"]]
                ax3.barh(range(len(mv_plot)), mv_plot["Hazard_Ratio"], color=mv_colors, height=0.6, alpha=0.8)

                for i, (feat, row) in enumerate(mv_plot.iterrows()):
                    lo = np.exp(row["coef lower 95%"])
                    hi = np.exp(row["coef upper 95%"])
                    ax3.plot([lo, hi], [i, i], color="black", linewidth=1.2)

                ax3.axvline(x=1.0, color="black", linestyle="--", linewidth=0.8)
                ax3.set_yticks(range(len(mv_plot)))
                ax3.set_yticklabels(mv_plot.index, fontsize=11)
                ax3.set_xlabel("Hazard Ratio", fontsize=14)
                ax3.set_title(f"Multivariate Cox Regression - Top {len(mv_plot)} Features", fontsize=15)
                plt.tight_layout()

                png_mv = os.path.join(cox_dir, "png", "cox_multivariate_forest_plot.png")
                pdf_mv = os.path.join(cox_dir, "pdf", "cox_multivariate_forest_plot.pdf")
                fig3.savefig(png_mv, bbox_inches='tight', dpi=150)
                fig3.savefig(pdf_mv, bbox_inches='tight')
                plt.close(fig3)
                print(png_mv)

                print(f"Multivariate Cox concordance index: {cph_multi.concordance_index_:.4f}")
            except Exception as e:
                print(f"WARNING: Multivariate Cox regression failed: {e}")

        print("=" * length)
        print(" Cox Regression Analysis Completed ")
        print("=" * length)

    # ------------------------------------------------------------------
    # Runner
    # ------------------------------------------------------------------
    def run_all_analyses(self):
        logging.info("RUNNING SURVIVAL ANALYSES")
        length = 110
        print("=" * length)
        print(" Starting Survival Analyses ")
        print("=" * length)

        if "kaplan_meier" in self.analyses:
            self.perform_kaplan_meier()
        if "cox_regression" in self.analyses:
            self.perform_cox_regression()

        print("=" * length)
        print(" All Survival Analyses Completed ")
        print("=" * length)
