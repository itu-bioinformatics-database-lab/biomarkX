import React, { useState } from 'react';
import HelpTooltip from './common/HelpTooltip';
import { helpTexts } from '../content/helpTexts';

function BarChartWithSelection({ chartUrl, classList, onClassSelection }) {
  // State to keep track of selected classes
  const [selectedClasses, setSelectedClasses] = useState([]);

  // Handle click on a class row to select/deselect
  const handleClassClick = (className) => {
    // Toggle selection
    if (selectedClasses.includes(className)) {
      setSelectedClasses(selectedClasses.filter((cls) => cls !== className));
    } else {
      setSelectedClasses([...selectedClasses, className]);
    }
  };

  // Check if a class is selected
  const isSelected = (className) => selectedClasses.includes(className);

  return (
    <div className="bar-chart-with-selection">
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <HelpTooltip placement="right" text={`${helpTexts.steps.step4.about} ${helpTexts.steps.step4.howTo}`}>info</HelpTooltip>
      </div>
      {/* Bar chart image section */}
      <div className="chart-container">
        <img src={chartUrl} alt="Diagnosis Bar Chart" className="chart-image" />
      </div>

      {/* Class selection table section */}
      <div className="class-selection">
        <h3>Classes in Your File</h3>
        <table>
          <tbody>
            {classList.map((className, index) => (
              // Each row represents a class, can be selected
              <tr
                key={index}
                className={isSelected(className) ? 'selected' : ''}
                onClick={() => handleClassClick(className)}
              >
                <td>{className}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Show analyze button when two or more classes are selected */}
        {selectedClasses.length >= 2 && (
          <button onClick={() => onClassSelection(selectedClasses)}>
            Analyze ({selectedClasses.length} classes selected)
          </button>
        )}
      </div>
    </div>
  );
}

export default BarChartWithSelection;
