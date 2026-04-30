import React, { useState, useEffect, useRef } from 'react';
import '../css/App.css';

const ImagePopup = ({ imagePath, imageName }) => {
  // State for modal open/close
  const [isModalOpen, setIsModalOpen] = useState(false);
  // State for image source
  const [imgSrc, setImgSrc] = useState('');
  // State for zoom level
  const [zoomLevel, setZoomLevel] = useState(1.0);
  
  // State variables for dragging (panning)
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  
  // Reference for the image container
  const imageContainerRef = useRef(null);
  
  // Check if the image is a SHAP force plot
  const isShapForcePlot = imageName && imageName.toLowerCase().includes('forceplot');
  
  useEffect(() => {
    // Reload image whenever imagePath changes
    if (imagePath) {
      // Add ?t param to prevent caching
      const cacheBuster = `?t=${new Date().getTime()}`;
      setImgSrc(`${imagePath}${cacheBuster}`);
    }
  }, [imagePath]);
  
  // When modal opens, reset zoom and pan
  useEffect(() => {
    if (isModalOpen) {
      setZoomLevel(1.0); // Reset zoom to 1.0x
      setTranslateX(0); // Reset pan position
      setTranslateY(0);
    }
  }, [isModalOpen]);
  
  // Zoom in handler
  const handleZoomIn = () => {
    setZoomLevel(prevZoom => Math.min(prevZoom + 0.5, 8)); // Max zoom 8x
  };
  
  // Zoom out handler
  const handleZoomOut = () => {
    setZoomLevel(prevZoom => Math.max(prevZoom - 0.5, 0.5)); // Min zoom 0.5x
  };
  
  // Reset zoom and pan
  const handleReset = () => {
    setZoomLevel(1.0);
    setTranslateX(0);
    setTranslateY(0);
  };

  // When mouse is pressed, start dragging
  const handleMouseDown = (e) => {
    // Only start with left mouse button
    if (e.button !== 0) return;
    setIsDragging(true);
    setStartX(e.clientX - translateX);
    setStartY(e.clientY - translateY);
    // Prevent default browser drag behavior
    e.preventDefault();
  };

  // When mouse moves, update pan position
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const newTranslateX = e.clientX - startX;
    const newTranslateY = e.clientY - startY;
    setTranslateX(newTranslateX);
    setTranslateY(newTranslateY);
    // Prevent default browser drag behavior
    e.preventDefault();
  };

  // When mouse is released, stop dragging
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // When mouse leaves the image area, stop dragging
  const handleMouseLeave = () => {
    if (isDragging) {
      setIsDragging(false);
    }
  };

  // Determine dynamic class for the image
  const getImageClassName = () => {
    if (!imageName) {
      return 'print-optimized-image'; // Default style if imageName is undefined
    }
    const nameLower = imageName.toLowerCase();
    
    if (nameLower.includes('shap summary')) {
      return 'shap-summary-plot';
    } else if (nameLower.includes('shap heatmap')) {
      return 'shap-heatmap-plot';
    } else if (nameLower.includes('waterfall')) {
      return 'shap-waterfall-plot';
    } else if (nameLower.includes('mean shap')) {
      return 'mean-shap-plot';
    } else if (nameLower.includes('forceplot for')) {
      return 'forceplot-for';
    }
    return 'print-optimized-image';
  };

  return (
    <div>
      {/* Thumbnail image */}
      {/* <div>{imageName}</div> */}
      <img
        src={imgSrc}
        alt={imageName}
        className={`${getImageClassName()}`}
        onClick={() => setIsModalOpen(true)} // Open modal on click
      />

      {/* Modal (enlarged image window) */}
      {isModalOpen && (
        // Modal overlay background
        <div className="modal zoom-modal" 
          style={{ 
            position: 'fixed',
            zIndex: 1000,
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}
          onClick={(e) => {
            // Only close if clicking directly on the modal background
            if (e.target.classList.contains('zoom-modal')) {
              setIsModalOpen(false);
            }
          }}>
          {/* Modal content container */}
          <div className="modal-content zoom-modal-content" 
            style={{ 
              backgroundColor: '#fefefe',
              margin: '1% auto',
              padding: '20px',
              border: '1px solid #888',
              width: '95%',
              height: '90vh',
              borderRadius: '8px',
              boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column'
            }}>
            {/* Close button */}
            <span className="close" 
              style={{
                color: '#aaa',
                position: 'absolute',
                top: '10px',
                right: '25px',
                fontSize: '35px',
                fontWeight: 'bold',
                cursor: 'pointer',
                zIndex: 10
              }}
              onClick={() => setIsModalOpen(false)}>&times;</span>
            
            {/* Zoom controls */}
            <div className="zoom-controls" style={{ 
              display: 'flex', 
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '10px',
              padding: '5px 15px',
              backgroundColor: '#f8f9fa',
              borderRadius: '4px'
            }}>
              <h3 style={{ margin: '0 10px 0 0' }}>Zoom: {Math.round(zoomLevel * 100)}%</h3>
              
              <div className="zoom-buttons" style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleZoomIn} style={{ padding: '5px 15px', cursor: 'pointer' }}>Zoom In (+)</button>
                <button onClick={handleZoomOut} style={{ padding: '5px 15px', cursor: 'pointer' }}>Zoom Out (-)</button>
                <button onClick={handleReset} style={{ padding: '5px 15px', cursor: 'pointer' }}>Reset</button>
              </div>
            </div>
            
            {/* Image container with pan and zoom */}
            <div className="image-container" 
              ref={imageContainerRef}
              style={{ 
                flex: 1,
                overflow: 'auto', 
                width: '100%', 
                height: 'calc(90vh - 80px)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                cursor: isDragging ? 'grabbing' : 'grab' // Change cursor style based on dragging
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
            >
              <div style={{ 
                display: 'flex', 
                justifyContent: 'center',
                alignItems: 'center',
                transform: `scale(${zoomLevel}) translate(${translateX / zoomLevel}px, ${translateY / zoomLevel}px)`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                height: '100%',
                width: '100%'
              }}>
                <img 
                  src={imgSrc} 
                  alt={imageName} 
                  style={{ 
                    maxHeight: '100%',
                    maxWidth: '100%',
                    objectFit: 'contain',
                    pointerEvents: 'none' // Prevent events on the image
                  }} 
                  className={`${isShapForcePlot ? 'shap-force-plot' : ''}`}
                  draggable="false" // Disable HTML5 drag behavior
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImagePopup;