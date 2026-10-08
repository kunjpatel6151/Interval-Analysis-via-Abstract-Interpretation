import React from 'react';
import { EXAMPLES, Example } from '../examples';

export interface ExampleSelectProps {
  selectedId: string;
  onSelect: (example: Example) => void;
  onReset: () => void;
}

export const ExampleSelect: React.FC<ExampleSelectProps> = ({
  selectedId,
  onSelect,
  onReset,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const ex = EXAMPLES.find((item) => item.id === e.target.value);
    if (ex) {
      onSelect(ex);
    }
  };

  const selectedExample = EXAMPLES.find((ex) => ex.id === selectedId);

  return (
    <div className="example-select-container">
      <label htmlFor="example-select" className="control-label">
        Example:
      </label>
      <select
        id="example-select"
        className="example-dropdown"
        value={selectedId}
        onChange={handleChange}
        aria-label="Select example program"
      >
        {EXAMPLES.map((ex) => (
          <option key={ex.id} value={ex.id}>
            {ex.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="btn btn-secondary"
        onClick={onReset}
        title="Reset editor text to selected example"
        aria-label="Reset editor to example source"
      >
        ↺ Reset
      </button>

      {selectedExample && (
        <span className="example-desc-tooltip" title={selectedExample.description}>
          ℹ {selectedExample.description}
        </span>
      )}
    </div>
  );
};
