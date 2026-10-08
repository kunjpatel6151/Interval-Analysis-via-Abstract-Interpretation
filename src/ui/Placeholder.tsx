import React from 'react';

export interface PlaceholderProps {
  title: string;
  subtitle?: string;
  icon?: string;
}

export const Placeholder: React.FC<PlaceholderProps> = ({
  title,
  subtitle = 'Coming in Phase 8B',
  icon = '🚧',
}) => {
  return (
    <div className="placeholder-card">
      <div className="placeholder-icon">{icon}</div>
      <div className="placeholder-title">{title}</div>
      <div className="placeholder-subtitle">{subtitle}</div>
    </div>
  );
};
