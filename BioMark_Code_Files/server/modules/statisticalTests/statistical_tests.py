# Load general packages
import pandas as pd
import numpy as np
import os

# Sklearn
from sklearn.preprocessing import LabelEncoder
from sklearn.feature_selection import f_classif
from sklearn import set_config

# Visualization
import seaborn as sns
import matplotlib.pyplot as plt

# Stats
from scipy.stats import ttest_ind, mannwhitneyu, kruskal

# Custom
from modules.logger import logging
from modules.feature_selection import feature_rank


set_config(transform_output="pandas")


class StatisticalTestAnalysis:
    """
    Statistical tests runner for ANOVA, t-Test, Wilcoxon rank-sum, and Kruskal-Wallis. Prepares data the same way as the
    previous DifferentiatingFactorAnalysis and saves results to feature_importances.json
    grouped by class pairs for downstream use (e.g., feature ranking summary).
    """

    def __init__(self,
                 data=None,
                 analyses=None,
                 labels_column: str = "Diagnosis",
                 reference_class: str = "Control",
                 sample_id_column: str = "Sample ID",
                 outdir: str = "output",
                 feature_type: str = "microRNA",
                 top_features_to_plot: int = 20,
                 volcano_p_value_threshold: float = 0.05,
                 volcano_log2fc_threshold: float = 1.0):

        sns.set_theme(style="darkgrid")
        self.data = data

        # Prepare X matrix with categorical preprocessing
        X_temp = data.drop([labels_column, sample_id_column], axis=1)

        categorical_columns = X_temp.select_dtypes(include=['object', 'category']).columns.tolist()
        numerical_columns = X_temp.select_dtypes(include=[np.number]).columns.tolist()

        self.categorical_encoding_info = {}
        if categorical_columns:
            dummies = pd.get_dummies(
                X_temp[categorical_columns],
                columns=categorical_columns,
                prefix=categorical_columns,
                drop_first=False,
                dummy_na=False
            )
            # Store mapping info for frontend/logging
            for col in categorical_columns:
                generated_cols = [c for c in dummies.columns if c.startswith(f"{col}_")]
                self.categorical_encoding_info[col] = {
                    'generated_columns': list(generated_cols),
                    'encoding_type': 'OneHot'
                }
            X_temp = pd.concat([X_temp.drop(columns=categorical_columns), dummies], axis=1)

        self.X = X_temp
        self.y = LabelEncoder().fit_transform(data[labels_column])
        self.feature_map = {feature: f"Feature_{i}" for i, feature in enumerate(self.X.columns)}
        self.feature_map_reverse = {value: key for key, value in self.feature_map.items()}
        self.X.columns = list(map(lambda x: self.feature_map[x], self.X.columns))
        self.labels = data[labels_column]
        self.label_encodings = dict(zip(self.y, self.labels))
        self.class_names = list(self.labels.unique())
        self.reference_class = reference_class
        self.outdir = outdir
        self.feature_type = feature_type
        self.top_features_to_plot = top_features_to_plot
        self.volcano_p_value_threshold = float(volcano_p_value_threshold)
        self.volcano_log2fc_threshold = float(volcano_log2fc_threshold)

        analyses = analyses or ["anova", "t_test"]
        analysis_aliases = {
            "ttest": "t_test",
            "t_test": "t_test",
            "anova": "anova",
            "wilcoxon": "wilcoxon_rank_sum",
            "wilcoxon_rank_sum": "wilcoxon_rank_sum",
            "kruskal": "kruskal_wallis",
            "kruskal_wallis": "kruskal_wallis",
            "volcano": "volcano",
            "volcano_plot": "volcano"
        }
        self.analyses = [analysis_aliases.get(a, a) for a in analyses]

        # Seed and random sample indices (kept for compatibility/logs if needed later)
        np.random.seed(42)

        # Prepare output directories
        directories = [term for term in self.analyses]
        for analysis in directories:
            for subdir in ["png", "pdf"]:
                os.makedirs(os.path.join(self.outdir, analysis, subdir), exist_ok=True)

        self.top_features = {}

    def perform_anova(self):
        logging.info("Performing ANOVA Analysis")
        length = 110
        print("=" * length)
        print(" Starting ANOVA")
        print("=" * length)

        f_statistic, p_values = f_classif(self.X, self.y)
        significant_features = pd.DataFrame({
            "Features": list(map(lambda x: self.feature_map_reverse[x], self.X.columns)),
            "F-value": f_statistic,
            "p-value": p_values
        })

        logging.info("Computing ANOVA Features")
        significant_features = significant_features.sort_values(by="F-value", ascending=False).reset_index(drop=True)

        # Save full ANOVA table to CSV for download
        try:
            anova_csv_path = os.path.join(self.outdir, "anova", "anova_results.csv")
            os.makedirs(os.path.dirname(anova_csv_path), exist_ok=True)
            significant_features.to_csv(anova_csv_path, index=False, sep=';', encoding='utf-8-sig')
        except Exception:
            pass

        logging.info("Plotting ANOVA Features")
        top_anova_features = significant_features[significant_features["p-value"] < 0.05].head(20)
        colors = top_anova_features['F-value'].apply(lambda x: "blue")

        plt.figure(figsize=(10, 15))
        plt.barh(top_anova_features['Features'], top_anova_features['F-value'], color=colors)
        plt.xlabel('F-value', fontsize=20)
        plt.xticks(fontsize=18)
        plt.yticks(fontsize=18)
        plt.title(f'ANOVA Feature Importance of Top Differentiating {self.feature_type}s', fontsize=20, loc='center', pad=15)
        plt.gca().invert_yaxis()

        logging.info("Saving Plots")
        plt.savefig(f'{self.outdir}/anova/png/anova_features_plot.png', bbox_inches='tight')
        plt.savefig(f'{self.outdir}/anova/pdf/anova_features_plot.pdf', bbox_inches='tight')
        print(f'{self.outdir}/anova/png/anova_features_plot.png')

        self.top_features["anova"] = {significant_features.Features[i]: significant_features["F-value"][i]
                                       for i in range(len(significant_features))}

        print(sorted(self.top_features["anova"], key=self.top_features["anova"].get, reverse=True)[:self.top_features_to_plot])
        print("=" * length)
        print(" ANOVA Analysis Completed ")
        print("=" * length)

    def perform_t_test(self):
        logging.info("Performing T-TEST")
        length = 110
        print("=" * length)
        print(" Starting t-Test")
        print("=" * length)

        if len(self.class_names) != 2:
            logging.warning("t-Test requires exactly two classes; skipping.")
            print("t-Test requires exactly two classes; skipping.")
            print("=" * length)
            return

        np.random.seed(0)

        class_0 = self.X.iloc[self.labels[self.labels == self.class_names[0]].dropna().index, :]
        class_1 = self.X.iloc[self.labels[self.labels == self.class_names[1]].dropna().index, :]

        t_test_values = {"Features": [], "statistic": [], "pvalue": [], "df": []}
        for column in self.X.columns:
            output = ttest_ind(class_0[column], class_1[column])
            t_test_values["Features"].append(column)
            t_test_values["pvalue"].append(output.pvalue)
            t_test_values["statistic"].append(output.statistic)
            t_test_values["df"].append(output.df)

        logging.info("Computing Feature Importance by Statistical Significance")
        p_values_df = pd.DataFrame(t_test_values)
        p_values_df["Abs(statistic)"] = p_values_df["statistic"].abs()
        p_values_df = p_values_df.sort_values(by="Abs(statistic)", ascending=False)
        p_values_df["Features"] = p_values_df["Features"].apply(lambda x: self.feature_map_reverse[x])

        # Save full t-test table to CSV for download
        try:
            ttest_csv_path = os.path.join(self.outdir, "t_test", "t_test_results.csv")
            os.makedirs(os.path.dirname(ttest_csv_path), exist_ok=True)
            p_values_df.to_csv(ttest_csv_path, index=False, sep=';', encoding='utf-8-sig')
        except Exception:
            pass

        logging.info("Plotting Top n Features")
        top_t_test_features = p_values_df[p_values_df.pvalue < 0.05].head(self.top_features_to_plot)
        colors = top_t_test_features['Abs(statistic)'].apply(lambda x: "blue")

        plt.figure(figsize=(10, 15))
        plt.barh(top_t_test_features['Features'], top_t_test_features['Abs(statistic)'], color=colors)
        plt.xlabel('Abs(statistic)', fontsize=20)
        plt.xticks(fontsize=18)
        plt.yticks(fontsize=18)
        plt.title(f't-Test Feature Importance of Top Differentiating {self.feature_type}s',
                  fontsize=25, loc='center', pad=15)
        plt.gca().invert_yaxis()

        logging.info("Saving Plots")
        plt.savefig(f'{self.outdir}/t_test/png/t_test_features_plot.png', bbox_inches='tight')
        plt.savefig(f'{self.outdir}/t_test/pdf/t_test_features_plot.pdf', bbox_inches='tight')
        print(f'{self.outdir}/t_test/png/t_test_features_plot.png')

        self.top_features["t_test"] = {p_values_df.Features[i]: p_values_df["Abs(statistic)"][i]
                                        for i in range(len(p_values_df))}

        print(sorted(self.top_features["t_test"], key=self.top_features["t_test"].get, reverse=True)[:self.top_features_to_plot])
        print("=" * length)
        print(" t-Test Analysis Completed ")
        print("=" * length)

    def perform_volcano(self):
        logging.info("Performing Volcano Analysis")
        length = 110
        print("=" * length)
        print(" Starting Volcano Analysis")
        print("=" * length)

        if len(self.class_names) != 2:
            logging.warning("Volcano analysis requires exactly two classes; skipping.")
            print("Volcano analysis requires exactly two classes; skipping.")
            print("=" * length)
            return

        np.random.seed(0)

        class_0 = self.X.iloc[self.labels[self.labels == self.class_names[0]].dropna().index, :]
        class_1 = self.X.iloc[self.labels[self.labels == self.class_names[1]].dropna().index, :]

        pseudo_count = 1e-9
        p_value_floor = 1e-300
        fc_threshold = max(0.0, float(self.volcano_log2fc_threshold))
        p_threshold = min(max(float(self.volcano_p_value_threshold), 1e-12), 1.0)

        volcano_values = {
            "Features": [],
            "log2FC": [],
            "pvalue": [],
            "neg_log10_pvalue": []
        }

        for column in self.X.columns:
            class_0_values = class_0[column]
            class_1_values = class_1[column]
            output = ttest_ind(class_0_values, class_1_values)

            mean_0 = float(np.mean(class_0_values))
            mean_1 = float(np.mean(class_1_values))

            # Robust log2 fold change for non-positive feature scales.
            min_value = float(min(class_0_values.min(), class_1_values.min()))
            offset = abs(min_value) + pseudo_count if min_value <= 0 else 0.0
            denom = mean_0 + offset + pseudo_count
            numer = mean_1 + offset + pseudo_count
            log2_fc = np.log2(numer / denom)

            raw_pvalue = output.pvalue
            if raw_pvalue is None or np.isnan(raw_pvalue) or raw_pvalue <= 0:
                safe_pvalue = p_value_floor
            else:
                safe_pvalue = float(raw_pvalue)

            volcano_values["Features"].append(column)
            volcano_values["log2FC"].append(log2_fc)
            volcano_values["pvalue"].append(safe_pvalue)
            volcano_values["neg_log10_pvalue"].append(-np.log10(safe_pvalue))

        volcano_df = pd.DataFrame(volcano_values)
        volcano_df["Features"] = volcano_df["Features"].apply(lambda x: self.feature_map_reverse[x])
        volcano_df["significant"] = (
            (volcano_df["pvalue"] < p_threshold) &
            (volcano_df["log2FC"].abs() >= fc_threshold)
        )

        volcano_df = volcano_df.sort_values(
            by=["significant", "neg_log10_pvalue"],
            ascending=[False, False]
        ).reset_index(drop=True)

        try:
            volcano_csv_path = os.path.join(self.outdir, "volcano", "volcano_results.csv")
            os.makedirs(os.path.dirname(volcano_csv_path), exist_ok=True)
            volcano_df.to_csv(volcano_csv_path, index=False, sep=';', encoding='utf-8-sig')
        except Exception:
            pass

        plt.figure(figsize=(10, 8))
        colors = volcano_df["significant"].map({True: "crimson", False: "gray"})
        plt.scatter(
            volcano_df["log2FC"],
            volcano_df["neg_log10_pvalue"],
            c=colors,
            alpha=0.75,
            s=35,
            edgecolors='none'
        )

        # Dynamic label selection based on fold-change borders.
        fallback_per_side = 5

        left_all_df = volcano_df[volcano_df["log2FC"] < 0].sort_values(
            by=["log2FC", "neg_log10_pvalue", "Features"],
            ascending=[True, False, True]
        )
        right_all_df = volcano_df[volcano_df["log2FC"] > 0].sort_values(
            by=["log2FC", "neg_log10_pvalue", "Features"],
            ascending=[False, False, True]
        )

        left_outside_df = left_all_df[left_all_df["log2FC"] < -fc_threshold]
        right_outside_df = right_all_df[right_all_df["log2FC"] > fc_threshold]

        labels_left_df = pd.DataFrame(columns=volcano_df.columns)
        labels_right_df = pd.DataFrame(columns=volcano_df.columns)

        if not left_outside_df.empty and not right_outside_df.empty:
            labels_left_df = left_outside_df
            labels_right_df = right_outside_df
        elif not right_outside_df.empty:
            mirror_count = len(right_outside_df)
            labels_right_df = right_outside_df
            labels_left_df = left_all_df.head(mirror_count)
        elif not left_outside_df.empty:
            mirror_count = len(left_outside_df)
            labels_left_df = left_outside_df
            labels_right_df = right_all_df.head(mirror_count)
        else:
            labels_left_df = left_all_df.head(fallback_per_side)
            labels_right_df = right_all_df.head(fallback_per_side)

        labels_df = pd.concat(
            [labels_left_df, labels_right_df],
            ignore_index=True
        ).drop_duplicates(subset=["Features"])

        plt.axhline(y=-np.log10(p_threshold), color='black', linestyle='--', linewidth=1)
        plt.axvline(x=fc_threshold, color='black', linestyle='--', linewidth=1)
        plt.axvline(x=-fc_threshold, color='black', linestyle='--', linewidth=1)

        x_min, x_max = plt.xlim()
        x_range = max(1e-9, x_max - x_min)
        edge_margin = 0.06 * x_range
        left_y_offsets = [4, 12, -4, 20, -12]
        right_y_offsets = [4, 12, -4, 20, -12]
        left_label_index = 0
        right_label_index = 0

        for _, row in labels_df.iterrows():
            x_val = float(row["log2FC"])
            y_val = float(row["neg_log10_pvalue"])
            if x_val <= x_min + edge_margin:
                x_offset = 8
                horizontal_align = "left"
            elif x_val >= x_max - edge_margin:
                x_offset = -8
                horizontal_align = "right"
            else:
                x_offset = 8 if x_val >= 0 else -8
                horizontal_align = "left" if x_val >= 0 else "right"

            if x_val < 0:
                y_offset = left_y_offsets[left_label_index % len(left_y_offsets)]
                left_label_index += 1
            else:
                y_offset = right_y_offsets[right_label_index % len(right_y_offsets)]
                right_label_index += 1

            plt.annotate(
                str(row["Features"]),
                xy=(x_val, y_val),
                xytext=(x_offset, y_offset),
                textcoords='offset points',
                fontsize=8,
                ha=horizontal_align,
                va='bottom',
                color='black',
                alpha=0.9,
                bbox=dict(boxstyle='round,pad=0.15', fc='white', ec='none', alpha=0.6)
            )

        plt.xlabel('log2 Fold Change', fontsize=14)
        plt.ylabel('-log10(p-value)', fontsize=14)
        plt.title(f'Volcano Plot of Differentiating {self.feature_type}s', fontsize=18, pad=12)
        plt.tight_layout()

        plt.savefig(f'{self.outdir}/volcano/png/volcano_plot.png', bbox_inches='tight')
        plt.savefig(f'{self.outdir}/volcano/pdf/volcano_plot.pdf', bbox_inches='tight')
        print(f'{self.outdir}/volcano/png/volcano_plot.png')

        self.top_features["volcano"] = {
            row["Features"]: float(abs(row["log2FC"]))
            for _, row in volcano_df.iterrows()
        }

        print("=" * length)
        print(" Volcano Analysis Completed ")
        print("=" * length)

    def perform_wilcoxon_rank_sum(self):
        logging.info("Performing Wilcoxon Rank-Sum Test")
        length = 110
        print("=" * length)
        print(" Starting Wilcoxon Rank-Sum")
        print("=" * length)

        if len(self.class_names) != 2:
            logging.warning("Wilcoxon rank-sum requires exactly two classes; skipping.")
            print("Wilcoxon rank-sum requires exactly two classes; skipping.")
            print("=" * length)
            return

        np.random.seed(0)

        class_0 = self.X.iloc[self.labels[self.labels == self.class_names[0]].dropna().index, :]
        class_1 = self.X.iloc[self.labels[self.labels == self.class_names[1]].dropna().index, :]

        wilcoxon_values = {"Features": [], "U statistic": [], "p-value": []}
        for column in self.X.columns:
            output = mannwhitneyu(class_0[column], class_1[column], alternative="two-sided")
            wilcoxon_values["Features"].append(column)
            wilcoxon_values["U statistic"].append(output.statistic)
            wilcoxon_values["p-value"].append(output.pvalue)

        logging.info("Computing Wilcoxon Rank-Sum Features")
        wilcoxon_df = pd.DataFrame(wilcoxon_values)
        wilcoxon_df = wilcoxon_df.sort_values(by="U statistic", ascending=False)
        wilcoxon_df["Features"] = wilcoxon_df["Features"].apply(lambda x: self.feature_map_reverse[x])

        # Save full Wilcoxon table to CSV for download
        try:
            wilcoxon_csv_path = os.path.join(self.outdir, "wilcoxon_rank_sum", "wilcoxon_rank_sum_results.csv")
            os.makedirs(os.path.dirname(wilcoxon_csv_path), exist_ok=True)
            wilcoxon_df.to_csv(wilcoxon_csv_path, index=False, sep=';', encoding='utf-8-sig')
        except Exception:
            pass

        logging.info("Plotting Top n Features (Wilcoxon Rank-Sum)")
        top_wilcoxon_features = wilcoxon_df[wilcoxon_df["p-value"] < 0.05].head(self.top_features_to_plot)
        colors = top_wilcoxon_features["U statistic"].apply(lambda x: "blue")

        plt.figure(figsize=(10, 15))
        plt.barh(top_wilcoxon_features["Features"], top_wilcoxon_features["U statistic"], color=colors)
        plt.xlabel('U statistic', fontsize=20)
        plt.xticks(fontsize=18)
        plt.yticks(fontsize=18)
        plt.title(f'Wilcoxon Rank-Sum Feature Importance of Top Differentiating {self.feature_type}s',
                  fontsize=20, loc='center', pad=15)
        plt.gca().invert_yaxis()

        logging.info("Saving Plots")
        plt.savefig(f'{self.outdir}/wilcoxon_rank_sum/png/wilcoxon_rank_sum_features_plot.png', bbox_inches='tight')
        plt.savefig(f'{self.outdir}/wilcoxon_rank_sum/pdf/wilcoxon_rank_sum_features_plot.pdf', bbox_inches='tight')
        print(f'{self.outdir}/wilcoxon_rank_sum/png/wilcoxon_rank_sum_features_plot.png')

        self.top_features["wilcoxon_rank_sum"] = {wilcoxon_df.Features[i]: wilcoxon_df["U statistic"][i]
                                                   for i in range(len(wilcoxon_df))}

        print(sorted(self.top_features["wilcoxon_rank_sum"], key=self.top_features["wilcoxon_rank_sum"].get, reverse=True)[:self.top_features_to_plot])
        print("=" * length)
        print(" Wilcoxon Rank-Sum Analysis Completed ")
        print("=" * length)

    def perform_kruskal_wallis(self):
        logging.info("Performing Kruskal-Wallis Test")
        length = 110
        print("=" * length)
        print(" Starting Kruskal-Wallis")
        print("=" * length)

        if len(self.class_names) < 2:
            logging.warning("Kruskal-Wallis requires at least two classes; skipping.")
            print("Kruskal-Wallis requires at least two classes; skipping.")
            print("=" * length)
            return

        np.random.seed(0)

        group_indices = {
            class_name: self.labels[self.labels == class_name].dropna().index
            for class_name in self.class_names
        }

        kruskal_values = {"Features": [], "H statistic": [], "p-value": []}
        for column in self.X.columns:
            groups = [self.X.loc[group_indices[name], column] for name in self.class_names]
            try:
                output = kruskal(*groups)
                statistic = output.statistic
                p_value = output.pvalue
            except Exception:
                statistic = 0.0
                p_value = 1.0
            kruskal_values["Features"].append(column)
            kruskal_values["H statistic"].append(statistic)
            kruskal_values["p-value"].append(p_value)

        logging.info("Computing Kruskal-Wallis Features")
        kruskal_df = pd.DataFrame(kruskal_values)
        kruskal_df = kruskal_df.sort_values(by="H statistic", ascending=False)
        kruskal_df["Features"] = kruskal_df["Features"].apply(lambda x: self.feature_map_reverse[x])

        # Save full Kruskal-Wallis table to CSV for download
        try:
            kruskal_csv_path = os.path.join(self.outdir, "kruskal_wallis", "kruskal_wallis_results.csv")
            os.makedirs(os.path.dirname(kruskal_csv_path), exist_ok=True)
            kruskal_df.to_csv(kruskal_csv_path, index=False, sep=';', encoding='utf-8-sig')
        except Exception:
            pass

        logging.info("Plotting Top n Features (Kruskal-Wallis)")
        top_kruskal_features = kruskal_df[kruskal_df["p-value"] < 0.05].head(self.top_features_to_plot)
        colors = top_kruskal_features["H statistic"].apply(lambda x: "blue")

        plt.figure(figsize=(10, 15))
        plt.barh(top_kruskal_features["Features"], top_kruskal_features["H statistic"], color=colors)
        plt.xlabel('H statistic', fontsize=20)
        plt.xticks(fontsize=18)
        plt.yticks(fontsize=18)
        plt.title(f'Kruskal-Wallis Feature Importance of Top Differentiating {self.feature_type}s',
                  fontsize=20, loc='center', pad=15)
        plt.gca().invert_yaxis()

        logging.info("Saving Plots")
        plt.savefig(f'{self.outdir}/kruskal_wallis/png/kruskal_wallis_features_plot.png', bbox_inches='tight')
        plt.savefig(f'{self.outdir}/kruskal_wallis/pdf/kruskal_wallis_features_plot.pdf', bbox_inches='tight')
        print(f'{self.outdir}/kruskal_wallis/png/kruskal_wallis_features_plot.png')

        self.top_features["kruskal_wallis"] = {kruskal_df.Features[i]: kruskal_df["H statistic"][i]
                                               for i in range(len(kruskal_df))}

        print(sorted(self.top_features["kruskal_wallis"], key=self.top_features["kruskal_wallis"].get, reverse=True)[:self.top_features_to_plot])
        print("=" * length)
        print(" Kruskal-Wallis Analysis Completed ")
        print("=" * length)

    def run_all_analyses(self):
        logging.info("RUNNING STATISTICAL ANALYSES")
        length = 110
        print("=" * length)
        print(" Starting Statistical Analyses ")
        print("=" * length)

        if "anova" in self.analyses:
            self.perform_anova()
        if "t_test" in self.analyses:
            self.perform_t_test()
        if "volcano" in self.analyses:
            self.perform_volcano()
        if "wilcoxon_rank_sum" in self.analyses:
            self.perform_wilcoxon_rank_sum()
        if "kruskal_wallis" in self.analyses:
            self.perform_kruskal_wallis()

        # Convert values to float for JSON serialization
        for a in self.top_features.keys():
            for feature in self.top_features[a].keys():
                self.top_features[a][feature] = float(self.top_features[a][feature])

        logging.info("Saving Feature Importances")
        # Save at base results/<file>/feature_importances.json (grouped by class pairs)
        base_outdir = os.path.dirname(self.outdir)
        json_path = os.path.join(base_outdir, "feature_importances.json")

        # Load existing
        import json
        if os.path.exists(json_path):
            with open(json_path, "r") as f:
                try:
                    existing_data = json.load(f)
                except json.JSONDecodeError:
                    existing_data = {}
        else:
            existing_data = {}

        class_pair = "_vs_".join(sorted(str(c) for c in self.class_names))
        if class_pair not in existing_data:
            existing_data[class_pair] = {}

        for a in self.top_features.keys():
            if a not in existing_data[class_pair]:
                existing_data[class_pair][a] = {}
            for feature, value in self.top_features[a].items():
                existing_data[class_pair][a][feature] = float(value)

        with open(json_path, "w") as f:
            json.dump(existing_data, f, indent=4)

        # Generate aggregated ranking CSVs using ONLY current run outputs
        # Structure: { class_pair: { analysis_name: {feature: score} } }
        try:
            filtered_for_ranking = {
                class_pair: {a: self.top_features[a] for a in self.top_features.keys()}
            }
            label_analyses = "+".join(sorted(self.top_features.keys())) if hasattr(self, 'top_features') and self.top_features else ""
            subdir = f"method=statistical_tests{',analysis=' + label_analyses if label_analyses else ''}"
            feature_rank(
                top_features=filtered_for_ranking,
                num_top_features=self.top_features_to_plot,
                feature_type=self.feature_type,
                outdir=base_outdir,
                subdir_label=subdir
            )
        except Exception:
            pass

        print("=" * length)
        print(" Statistical Analyses Completed ")
        print("=" * length)

        # Write a concise README to clarify directory structure for this class pair
        try:
            readme_path = os.path.join(self.outdir, "README.md")
            with open(readme_path, "w", encoding="utf-8") as rf:
                rf.write(
                    "# Analysis Outputs\n\n"
                    "This folder contains statistical analysis outputs for the selected class pair.\n\n"
                    "- feature_ranking/: aggregated ranking CSVs live under `../feature_ranking/<ClassA_ClassB>/ranked_features_df.csv`\n\n"
                    "Notes:\n"
                    "- Aggregated `feature_importances.json` is saved at the parent folder and grouped by model key.\n"
                    "- The canonical ranked features CSV is only under `feature_ranking/<ClassA_ClassB>/`.\n"
                )
        except Exception:
            pass


