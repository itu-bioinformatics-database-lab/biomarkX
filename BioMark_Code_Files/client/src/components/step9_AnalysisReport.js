import React, { useState, useEffect, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import '../css/step9-generateAnalysisReport.css';
import { buildUrl } from '../api';
// Removed unused imports

/**
 * Component for generating biomarker analysis report
 *
 * IMPORTANT: The `analysisResults` prop from `App.js` is expected to have the following structure for each analysis:
 * {
 *   title: string,        // e.g., "Analysis 1"
 *   images: Array<{ id: string, path: string, caption: string }>,
 *   classPair: string,    // e.g., "Disease vs Healthy"
 *   date: string,         // Date of analysis
 *   time: string,         // Execution time
 *   types: {              // Analysis types
 *     differential?: string[],
 *     clustering?: string[],
 *     classification?: string[]
 *   },
 *   parameters?: object    // Optional extra parameters (e.g., for caption generation)
 * }
 */
const AnalysisReport = ({ 
  analysisResults, // This prop should have the enriched structure described above
  // The following global props can still be used for a general report title or summary for all analyses,
  // but main details now come from `analysisResults`.
  analysisDate, 
  executionTime, 
  selectedClasses, // Global - last selected or general context
  selectedIllnessColumn, // Global
  selectedAnalyzes, // Global
  featureCount, // Global
  // selectedClassPair, // already comes from summarizeAnalyses
  summaryImagePath, // This prop is related to summarizeAnalyses and its structure is preserved
  summarizeAnalyses, // This prop's structure is good and preserved
  datasetFileName // Name of the file used in the analysis
}) => {
  // State for loading overlay
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logoDataUrl, setLogoDataUrl] = useState(null);

  // Helper to render analysis type selections (supports old and new keys)
  const buildAnalysisTypesText = (typesObj) => {
    if (!typesObj || typeof typesObj !== 'object') return 'N/A';
    const parts = [];
    const add = (arr, label) => {
      if (Array.isArray(arr) && arr.length) parts.push(`${label}: ${arr.join(', ')}`);
    };
    // New keys
    add(typesObj.statisticalTest, 'Statistical Test');
    add(typesObj.dimensionalityReduction, 'Dimensionality Reduction');
    add(typesObj.classificationAnalysis, 'Classification');
    add(typesObj.modelExplanation, 'Model Explanation');
    // Backward-compatibility with old keys
    add(typesObj.differential, 'Statistical Test');
    add(typesObj.clustering, 'Dimensionality Reduction');
    add(typesObj.classification, 'Classification');
    return parts.length ? parts.join('; ') : 'N/A';
  };

  // Group analyses by class pairs
  const groupedAnalyses = useMemo(() => {
    if (!analysisResults || !Array.isArray(analysisResults)) return {};
    return analysisResults.reduce((acc, analysis) => {
      // Assume each analysis object has a 'classPair' field.
      const classPairKey = analysis.classPair || 'Unknown Class Pair';
      if (!acc[classPairKey]) {
        acc[classPairKey] = [];
      }
      acc[classPairKey].push(analysis);
      return acc;
    }, {});
  }, [analysisResults]);
  
  // Load logo as DataURL for PDF
  useEffect(() => {
    const loadLogo = async () => {
      try {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = (process.env.PUBLIC_URL || '') + '/logo192.png';
        
        img.onload = () => {
          // Draw logo to canvas and get DataURL
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, img.width, img.height);
          
          setLogoDataUrl(canvas.toDataURL('image/png'));
        };
        
        img.onerror = () => {
          console.error("Logo could not be loaded");
        };
      } catch (error) {
        console.error("Logo loading error:", error);
      }
    };
    
    loadLogo();
  }, []);
  
  // PDF generation function
  const generatePDF = async () => {
    const reportElement = document.getElementById('analysis-report');
    
    if (!reportElement) {
      console.error('Report element not found');
      return;
    }
    
    // Show loading overlay
    setLoading(true);
    setProgress(5);
    
    try {
      // Calculate content height      
      // Set PDF page size based on content
      const pageWidth = 210; // A4 width (mm)
      const pageHeight = 297; // Standard A4 height (mm). Additional pages will be added automatically.
      // contentHeight * 0.3528
      // Create PDF
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [pageWidth, pageHeight]
      });
      
      setProgress(10);
      
      // Margin values
      const marginLeft = 20;
      const marginRight = 20;
      
      // Content width
      const contentWidth = pageWidth - marginLeft - marginRight;
      
      // 30mm space for logo and title
      const topMargin = 40;
      
      let yPosition = topMargin;
      
      // ----- COVER TITLE -----
      
      // Add logo
      if (logoDataUrl) {
        try {
          const logoWidth = 50;
          const logoHeight = 50;
          const logoX = (pageWidth - logoWidth) / 2;
          const logoY = yPosition;
          
          pdf.addImage(logoDataUrl, 'PNG', logoX, logoY, logoWidth, logoHeight);
          yPosition += logoHeight + 20;
        } catch (error) {
          console.error("Error adding logo to PDF:", error);
        }
      }
      
      // Report title
      pdf.setFontSize(28);
      pdf.setTextColor(40, 40, 40);
      pdf.setFont('helvetica', 'bold');
      pdf.text('BIOMARKER', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 15;
      pdf.text('ANALYSIS REPORT', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 20;
      
      // Decorative line
      pdf.setDrawColor(74, 109, 167);
      pdf.setLineWidth(1);
      pdf.line(marginLeft + 30, yPosition, pageWidth - marginRight - 30, yPosition);
      yPosition += 20;
      
      // Subtitle
      pdf.setFontSize(16);
      pdf.setTextColor(80, 80, 80);
      pdf.setFont('helvetica', 'italic');
      pdf.text('Comprehensive Analysis Results', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 20;
      
      // Class info - List all analyzed pairs
      pdf.setFontSize(12); // Adjusted font size
      pdf.setTextColor(90, 90, 90);
      pdf.setFont('helvetica', 'normal');
      
      if (Object.keys(groupedAnalyses).length > 0) {
        Object.keys(groupedAnalyses).forEach(classPair => {
          if (yPosition > pageHeight - 50) { // New page if near end
            pdf.addPage();
            yPosition = topMargin - 20;
          }
          pdf.text(`Comparing: ${classPair}`, pageWidth / 2, yPosition, { align: 'center' });
          yPosition += 8;
        });
      } else if (selectedClasses && selectedClasses.length >= 2) {
        // Fallback to global selectedClasses if no groupedAnalyses
        pdf.text(`Comparing: ${selectedClasses.join(' vs ')}`, pageWidth / 2, yPosition, { align: 'center' });
        yPosition += 8;
      }
      yPosition += 12;
      
      // Decorative bottom line
      pdf.setDrawColor(220, 220, 220);
      pdf.setLineWidth(0.5);
      pdf.line(marginLeft + 40, yPosition, pageWidth - marginRight - 40, yPosition);
      yPosition += 20;
      
      // Corporate info
      pdf.setFontSize(10);
      pdf.setTextColor(150, 150, 150);
      pdf.text('Biomark - Biomarker Analysis Tool © ' + new Date().getFullYear(), pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 10;
      pdf.text('All Rights Reserved', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 30;
      
      // ----- ANALYSIS SUMMARY -----
      
      // Section title
      pdf.setFontSize(16);
      pdf.setTextColor(60, 60, 60);
      pdf.setFont('helvetica', 'bold');
      pdf.text('1. Analysis Summary', marginLeft, yPosition);
      yPosition += 10;
      
      // Bottom line
      pdf.setDrawColor(74, 109, 167);
      pdf.setLineWidth(0.5);
      pdf.line(marginLeft, yPosition, marginLeft + 50, yPosition);
      yPosition += 15;
      
      // Summary info - now by grouped analyses
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(80, 80, 80);
      
      const leftColumnX = marginLeft;
      const lineHeight = 6;

      // Dataset filename info
      if (datasetFileName) {
        pdf.setFont('helvetica', 'bold');
        pdf.text('Dataset Filename:', leftColumnX, yPosition);
        pdf.setFont('helvetica', 'normal');
        pdf.text(datasetFileName, leftColumnX + 40, yPosition);
        yPosition += lineHeight + 5;
      }

      if (Object.keys(groupedAnalyses).length > 0) {
        let groupIndex = 0;
        for (const [classPair, analysesInGroup] of Object.entries(groupedAnalyses)) {
          if (yPosition > pageHeight - 70) { pdf.addPage(); yPosition = topMargin - 20; }
          
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(65, 65, 65);
          pdf.text(classPair, leftColumnX, yPosition);
          yPosition += lineHeight + 2;
          pdf.setDrawColor(150,150,150);
          pdf.setLineWidth(0.2);
          pdf.line(leftColumnX, yPosition, pageWidth - marginRight, yPosition);
          yPosition += lineHeight + 2;

          let analysisIndexInGroup = 0;
          for (const analysis of analysesInGroup) {
            if (yPosition > pageHeight - 60) { pdf.addPage(); yPosition = topMargin - 20; }
            
            pdf.setFontSize(11);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(70, 70, 70);
            // analysis.title (e.g., "Analysis 1") should already include this.
            // If analysis.title is missing: `Analysis ${analysisIndexInGroup + 1}`
            pdf.text(analysis.title ? `${analysis.title.replace(/Analysis \d+/, `Analysis ${analysisIndexInGroup + 1}`)}` : `Analysis ${analysisIndexInGroup + 1}`, leftColumnX + 5, yPosition);
            yPosition += lineHeight;

            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(80, 80, 80);

            // Analysis date
            pdf.setFont('helvetica', 'bold');
            pdf.text('Analysis Date:', leftColumnX + 10, yPosition);
            pdf.setFont('helvetica', 'normal');
            pdf.text(analysis.date || 'N/A', leftColumnX + 40, yPosition);
            yPosition += lineHeight;

            // Analysis types
            pdf.setFont('helvetica', 'bold');
            pdf.text('Analysis Types:', leftColumnX + 10, yPosition);
            pdf.setFont('helvetica', 'normal');
            const analysisTypesText = buildAnalysisTypesText(analysis.types);
            const splitTypes = pdf.splitTextToSize(analysisTypesText, contentWidth - 30);
            pdf.text(splitTypes, leftColumnX + 40, yPosition);
            yPosition += lineHeight * splitTypes.length;
            
            // Execution time
            pdf.setFont('helvetica', 'bold');
            pdf.text('Execution Time:', leftColumnX + 10, yPosition);
            pdf.setFont('helvetica', 'normal');
            pdf.text(analysis.time || 'N/A', leftColumnX + 40, yPosition);
            yPosition += lineHeight + 5;
            analysisIndexInGroup++;
          }
          
          if (groupIndex < Object.keys(groupedAnalyses).length - 1) {
             yPosition += 5;
          }
          groupIndex++;
        }
      } else {
        // Fallback if no groupedAnalyses (old global info)
        pdf.setFont('helvetica', 'bold');
        pdf.text('Analysis Date:', leftColumnX, yPosition);
        pdf.setFont('helvetica', 'normal');
        pdf.text(analysisDate || 'N/A', leftColumnX + 30, yPosition);
        yPosition += lineHeight;
      }
      yPosition += 10;

      // ----- STATISTICAL ANALYSIS RESULTS -----
      if (summarizeAnalyses && summarizeAnalyses.length > 0) {
        // Section title
        pdf.setFontSize(16);
        pdf.setTextColor(60, 60, 60);
        pdf.setFont('helvetica', 'bold');
        pdf.text('2. Statistical Method Results', marginLeft, yPosition);
        yPosition += 10;
        
        // Bottom line
        pdf.setDrawColor(74, 109, 167);
        pdf.setLineWidth(0.5);
        pdf.line(marginLeft, yPosition, marginLeft + 70, yPosition);
        yPosition += 15;
        
        // Add summary image - summarizeAnalyses already comes by classPair
        for (let k = 0; k < summarizeAnalyses.length; k++) {
          const summaryAnalysis = summarizeAnalyses[k];
          if (yPosition > pageHeight - 80) { pdf.addPage(); yPosition = topMargin - 20; }

          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(70, 70, 70);
          pdf.text(`Summary for: ${summaryAnalysis.classPair || 'All Classes'}`, marginLeft, yPosition);
          yPosition += 8;

          try {
            // Load the summary image directly (avoid html2canvas and DOM dependency)
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.src = summaryAnalysis.imagePath;

            await new Promise((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error(`Failed to load image: ${summaryAnalysis.imagePath.split('/').pop()}`));
              setTimeout(() => reject(new Error('Image loading timeout')), 15000);
            });

            const canvas = document.createElement('canvas');
            const scaleFactor = 2;
            canvas.width = img.width * scaleFactor;
            canvas.height = img.height * scaleFactor;
            const ctx = canvas.getContext('2d');
            ctx.scale(scaleFactor, scaleFactor);
            ctx.drawImage(img, 0, 0, img.width, img.height);

            const imgData = canvas.toDataURL('image/jpeg', 0.85);
            const aspectRatio = img.width / img.height;
            let imgWidth = contentWidth;
            let imgHeight = imgWidth / aspectRatio;

            const maxImgHeight = pageHeight * 0.6;
            if (imgHeight > maxImgHeight) {
              imgHeight = maxImgHeight;
              imgWidth = imgHeight * aspectRatio;
            }

            if (yPosition + imgHeight > pageHeight - 30) {
              pdf.addPage();
              yPosition = topMargin - 20;
              pdf.setFontSize(12);
              pdf.setFont('helvetica', 'bold');
              pdf.setTextColor(70, 70, 70);
              pdf.text(`Summary for: ${summaryAnalysis.classPair || 'All Classes'} (Continued)`, marginLeft, yPosition);
              yPosition += 8;
            }

            pdf.addImage(imgData, 'JPEG', marginLeft + (contentWidth - imgWidth) / 2, yPosition, imgWidth, imgHeight);
            yPosition += imgHeight + 15;
          } catch (error) {
            console.error('Error adding image:', error);
            if (yPosition > pageHeight - 30) { pdf.addPage(); yPosition = topMargin - 20; }
            pdf.setFontSize(10);
            pdf.setTextColor(255, 0, 0);
            pdf.text(`*Summary image for ${summaryAnalysis.classPair} failed: ${error.message}`, marginLeft, yPosition);
            yPosition += 10;
          }
          yPosition += 10;
        }
      }
      
      // ----- DETAILED ANALYSIS RESULTS (Charts) -----
      if (Object.keys(groupedAnalyses).length > 0) {
        if (yPosition > pageHeight - 40) { pdf.addPage(); yPosition = topMargin - 20; }
        // Section title
        pdf.setFontSize(16);
        pdf.setTextColor(60, 60, 60);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${summarizeAnalyses && summarizeAnalyses.length > 0 ? '3' : '2'}. Analysis Results`, marginLeft, yPosition);
        yPosition += 10;
        
        // Bottom line
        pdf.setDrawColor(74, 109, 167);
        pdf.setLineWidth(0.5);
        pdf.line(marginLeft, yPosition, marginLeft + 85, yPosition);
        yPosition += 15;
        
        let groupIdxForResults = 0;
        for (const [classPair, analysesInGroup] of Object.entries(groupedAnalyses)) {
          if (yPosition > pageHeight - 60) { pdf.addPage(); yPosition = topMargin - 20; }

          pdf.setFontSize(14);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(65, 65, 65);
          pdf.text(classPair, marginLeft, yPosition);
          yPosition += 8;
           pdf.setDrawColor(180,180,180);
           pdf.setLineWidth(0.2);
           pdf.line(marginLeft, yPosition, pageWidth - marginRight, yPosition);
           yPosition += 10;

          let analysisIdxInResults = 0;
          for (const analysis of analysesInGroup) {
            if (yPosition > pageHeight - 50) { pdf.addPage(); yPosition = topMargin - 20; }
            
            pdf.setFontSize(12);
            pdf.setTextColor(70, 70, 70);
            pdf.setFont('helvetica', 'bold');
            // analysis.title (e.g., "Analysis 1") should already include this.
            pdf.text(analysis.title ? `${analysis.title.replace(/Analysis \d+/, `Analysis ${analysisIdxInResults + 1}`)} for ${classPair}` : `Analysis ${analysisIdxInResults + 1} for ${classPair}`, marginLeft + 5, yPosition);
            yPosition += 8;
            
            if (analysis.images && analysis.images.length > 0) {
              for (let j = 0; j < analysis.images.length; j++) {
                try {
                  if (analysis.images[j].path) {
                    if (yPosition > pageHeight - 80 && !(j === 0 && analysisIdxInResults === 0 && groupIdxForResults === 0)) {
                       pdf.addPage(); 
                       yPosition = topMargin - 20; 
                    }

                    // Image caption
                    if (analysis.images[j].caption) {
                      pdf.setFontSize(10);
                      pdf.setTextColor(100, 100, 100);
                      pdf.setFont('helvetica', 'italic');
                      const splitCaption = pdf.splitTextToSize(analysis.images[j].caption, contentWidth);
                      pdf.text(splitCaption, marginLeft + 5, yPosition);
                      yPosition += 5 * splitCaption.length;
                    }
                    
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.src = analysis.images[j].path;
                    
                    await new Promise((resolve, reject) => {
                      img.onload = () => {
                        resolve();
                      };
                      img.onerror = (err) => {
                        reject(new Error(`Failed to load image: ${analysis.images[j].path.split('/').pop()}`));
                      };
                      setTimeout(() => {
                        reject(new Error('Image loading timeout'));
                      }, 15000);
                    });
                    
                    const canvas = document.createElement('canvas');
                    const scaleFactor = 2;
                    canvas.width = img.width * scaleFactor;
                    canvas.height = img.height * scaleFactor;
                    const ctx = canvas.getContext('2d');
                    ctx.scale(scaleFactor, scaleFactor);
                    ctx.drawImage(img, 0, 0, img.width, img.height);
                    
                    const imgData = canvas.toDataURL('image/jpeg', 0.85);
                    const aspectRatio = img.width / img.height;
                    let imgPdfWidth = contentWidth;
                    let imgPdfHeight = imgPdfWidth / aspectRatio;

                    // Adjust image size to prevent page overflow
                    const maxImgHeight = pageHeight * 0.7;
                    if (imgPdfHeight > maxImgHeight) {
                        imgPdfHeight = maxImgHeight;
                        imgPdfWidth = imgPdfHeight * aspectRatio;
                    }
                    if (imgPdfWidth > contentWidth) {
                        imgPdfWidth = contentWidth;
                        imgPdfHeight = imgPdfWidth / aspectRatio;
                    }

                    if (yPosition + imgPdfHeight > pageHeight - 25) {
                      pdf.addPage();
                      yPosition = topMargin - 20;
                       pdf.setFontSize(10);
                       pdf.setTextColor(100,100,100);
                       pdf.setFont('helvetica', 'italic');
                       pdf.text(analysis.images[j].caption + " (Continued)", marginLeft+5, yPosition);
                       yPosition +=5;
                    }
                    
                    pdf.addImage(imgData, 'JPEG', marginLeft + (contentWidth - imgPdfWidth) / 2, yPosition, imgPdfWidth, imgPdfHeight);
                    yPosition += imgPdfHeight + 10;
                  }
                } catch (error) {
                  if (yPosition > pageHeight - 30) { pdf.addPage(); yPosition = topMargin - 20; }
                  pdf.setFontSize(9);
                  pdf.setTextColor(255, 0, 0);
                  pdf.text(`*Image '${analysis.images[j].caption}' could not be loaded: ${error.message}`, marginLeft + 5, yPosition);
                  yPosition += 5;
                }
              }
            }
            yPosition += 5;
            analysisIdxInResults++;
          }
          if (groupIdxForResults < Object.keys(groupedAnalyses).length - 1) {
            yPosition += 10;
            if (yPosition > pageHeight - 30) { pdf.addPage(); yPosition = topMargin - 20; }
            pdf.setDrawColor(200,200,200);
            pdf.setLineWidth(0.3);
            pdf.line(marginLeft, yPosition, pageWidth-marginRight, yPosition);
            yPosition += 10;
          }
          groupIdxForResults++;
        }
      }
      
      // Footer
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.setFont('helvetica', 'italic');
      const currentDate = new Date().toLocaleString();
      const version = "2.3.0";
      
      // Leave enough space for footer
      yPosition += 5;
      
      // Footer line
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.5);
      pdf.line(marginLeft, yPosition, pageWidth - marginRight, yPosition);
      yPosition += 15;
      
      // Footer text
      pdf.text(`This report was automatically generated by Biomark - Biomarker Analysis Tool v${version} on ${currentDate}`, pageWidth / 2, yPosition, { align: 'center' });
      
      // Save PDF
      pdf.save(`Biomarker_Analysis_Report_${new Date().toISOString().split('T')[0]}_${datasetFileName}.pdf`);
      
      setProgress(100);
      
      // Hide loading overlay after completion
      setTimeout(() => {
        setLoading(false);
        setProgress(0);
      }, 500);
    } catch (error) {
      setLoading(false);
      setProgress(0);
      alert('An error occurred while generating the report. Please try again.');
    }
  };

  // Version info
  const version = "2.3.0";

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
        <button 
          className="generate-report-button" 
          onClick={generatePDF}
          title="Generate a professional PDF report of your analysis results"
          disabled={loading}
        >
          <i className="report-icon">{loading ? '⏳' : '📊'}</i>
          {loading ? 'Generating Report...' : 'Generate Analysis Report'}
        </button>
      </div>
      
      {/* Loading Overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner"></div>
          <div className="loading-text">
            Generating your professional report... ({progress}%)
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
      )}
      
      {/* Hidden report template - html2canvas will be used for PDF generation */}
      <div id="analysis-report" className="hidden-report-template">
        <div className="report-content">
          {/* Cover Title */}
          <div className="report-header">
            <h1>BIOMARKER ANALYSIS REPORT</h1>
            <h2>Comprehensive Analysis Results</h2>
            {Object.keys(groupedAnalyses).length > 0 ? (
              Object.keys(groupedAnalyses).map(classPair => (
                <p key={classPair}>Comparing: {classPair}</p>
              ))
            ) : (
              selectedClasses && selectedClasses.length >= 2 && (
                <p>Comparing: {selectedClasses.join(' vs ')}</p>
              )
            )}
          </div>

          {/* Analysis Summary */}
          <div className="report-section">
            <h3>1. Analysis Summary</h3>
            {datasetFileName && (
              <div className="info-row">
                <span className="label">Dataset Filename:</span>
                <span className="value">{datasetFileName}</span>
              </div>
            )}
            {Object.keys(groupedAnalyses).length > 0 ? (
              Object.entries(groupedAnalyses).map(([classPair, analysesInGroup]) => (
                <div key={classPair} className="class-pair-summary-group">
                  <h4>{classPair}</h4>
                  {analysesInGroup.map((analysis, index) => (
                    <div key={analysis.title || index} className="analysis-summary-item">
                      <h5>{analysis.title ? analysis.title.replace(/Analysis \d+/, `Analysis ${index + 1}`) : `Analysis ${index + 1}`}</h5>
                      <div className="info-row">
                        <span className="label">Analysis Date:</span>
                        <span className="value">{analysis.date || 'N/A'}</span>
                      </div>
                      <div className="info-row">
                        <span className="label">Analysis Types:</span>
                        <span className="value">{buildAnalysisTypesText(analysis.types)}</span>
                      </div>
                      <div className="info-row">
                        <span className="label">Execution Time:</span>
                        <span className="value">{analysis.time || 'N/A'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div className="summary-info"> {/* Fallback to old global summary if no grouped data */}
                 <div className="info-row">
                    <span className="label">Analysis Date:</span>
                    <span className="value">{analysisDate || 'N/A'}</span>
                  </div>
                  {/* ... other global fields ... */}
              </div>
            )}
          </div>

          {/* Statistical Analysis Results */}
          {summarizeAnalyses && summarizeAnalyses.length > 0 && (
            <div className="report-section">
              <h3>2. Statistical Method Results</h3>
              {summarizeAnalyses.map((analysis, index) => (
                // Add data-classpair to help PDF image selector
                <div key={index} className="summary-section" data-classpair={analysis.classPair}>
                  <h4>Analysis for {analysis.classPair}</h4>
                  <div className="summary-image">
                    <img 
                        src={analysis.imagePath.startsWith('http') ? analysis.imagePath : buildUrl(`/${analysis.imagePath}`)} 
                        alt={`Statistical Analysis for ${analysis.classPair}`} 
                        crossOrigin="anonymous"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Detailed Analysis Results (Charts) */}
          {Object.keys(groupedAnalyses).length > 0 && (
            <div className="report-section">
              <h3>{summarizeAnalyses && summarizeAnalyses.length > 0 ? '3' : '2'}. Analysis Results</h3>
              {Object.entries(groupedAnalyses).map(([classPair, analysesInGroup]) => (
                <div key={classPair} className="class-pair-results-group">
                  <h4>{classPair}</h4>
                  {analysesInGroup.map((analysis, index) => (
                    <div key={analysis.title || index} className="analysis-result-item">
                      <h5>{analysis.title ? analysis.title.replace(/Analysis \d+/, `Analysis ${index + 1}`) : `Analysis ${index + 1}`}</h5>
                      {analysis.images?.map((image, imgIndex) => (
                        <div key={image.id || imgIndex} className="result-image">
                          {image.caption && <p className="image-caption">{image.caption}</p>}
                          <img 
                            src={image.path.startsWith('http') ? image.path : buildUrl(`/${image.path}`)} 
                            alt={image.caption || `Image ${imgIndex + 1} for ${analysis.title}`} 
                            crossOrigin="anonymous"
                           />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="report-footer">
            <p>This report was automatically generated by Biomarker Analysis Tool v{version} on {new Date().toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalysisReport; 