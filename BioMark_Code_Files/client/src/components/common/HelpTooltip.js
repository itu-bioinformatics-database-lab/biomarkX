import React, { useState, useRef, useEffect, useCallback } from 'react';

const HelpTooltip = ({ text, children, placement = 'right', useFixedPosition = false }) => {
  // sticky: toggled by click, keeps tooltip open until toggled off
  // hoverTrigger/hoverContent: track hover state over trigger and content
  const [sticky, setSticky] = useState(false);
  const [hoverTrigger, setHoverTrigger] = useState(false);
  const [hoverContent, setHoverContent] = useState(false);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const [fixedStyle, setFixedStyle] = useState(null);

  const visible = sticky || hoverTrigger || hoverContent;

  const updatePosition = useCallback(() => {
    if (!useFixedPosition || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;
    let top = rect.top + rect.height / 2;
    let left = rect.right + gap;
    let transform = 'translate(0, -50%)';

    if (placement === 'left') {
      left = rect.left - gap;
      transform = 'translate(-100%, -50%)';
    }
    if (placement === 'bottom') {
      top = rect.bottom + gap;
      left = rect.left;
      transform = 'translate(0, 0)';
    }

    setFixedStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      transform,
      zIndex: 2000
    });
  }, [placement, useFixedPosition]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        // Close when clicking outside; clear sticky and hovers
        setSticky(false);
        setHoverTrigger(false);
        setHoverContent(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!visible || !useFixedPosition) return undefined;
    updatePosition();

    const handleScroll = () => updatePosition();
    const modalBody = ref.current?.closest('.norm-modal')?.querySelector('.norm-modal-body');

    window.addEventListener('resize', handleScroll);
    if (modalBody) modalBody.addEventListener('scroll', handleScroll);

    return () => {
      window.removeEventListener('resize', handleScroll);
      if (modalBody) modalBody.removeEventListener('scroll', handleScroll);
    };
  }, [updatePosition, useFixedPosition, visible]);

  return (
    <span className="help-tooltip" ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <span
        className="help-tooltip-trigger"
        ref={triggerRef}
        onClick={() => setSticky((s) => !s)}
        onMouseEnter={() => setHoverTrigger(true)}
        onMouseLeave={() => setHoverTrigger(false)}
        aria-label="Show help"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '3px 8px',
          borderRadius: '10px',
          background: '#e9eef9',
          color: '#3f51b5',
          fontWeight: 600,
          fontSize: '12px',
          cursor: 'pointer',
          userSelect: 'none',
          lineHeight: 1
        }}
      >
        {children || 'info'}
      </span>
      {visible && (
        <div
          className="help-tooltip-content"
          ref={tooltipRef}
          role="tooltip"
          onMouseEnter={() => setHoverContent(true)}
          onMouseLeave={() => setHoverContent(false)}
          style={{
            position: 'absolute',
            ...(placement === 'right' ? { top: '50%', left: '110%', transform: 'translateY(-50%)' } : { top: '110%', left: 0 }),
            ...(useFixedPosition && fixedStyle ? fixedStyle : {}),
            zIndex: 1000,
            width: '360px',
            maxWidth: 'min(90vw, 480px)',
            minWidth: '280px',
            maxHeight: '50vh',
            overflowY: 'auto',
            background: '#ffffff',
            color: '#333',
            padding: '10px 12px',
            border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: '8px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            lineHeight: 1.4,
            fontSize: '13px'
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
};

export default HelpTooltip;


