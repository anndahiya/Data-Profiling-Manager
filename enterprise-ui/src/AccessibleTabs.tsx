import type { KeyboardEvent } from 'react';

export function AccessibleTabs({ items, value, onChange, label, idPrefix }: {
  items: string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  idPrefix: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    onChange(items[nextIndex]);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIndex]?.focus();
  };

  return <div className="tabs" role="tablist" aria-label={label}>
    {items.map((item, index) => {
      const selected = value === item;
      const slug = item.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return <button
        key={item}
        id={`${idPrefix}-tab-${slug}`}
        role="tab"
        aria-selected={selected}
        aria-controls={`${idPrefix}-panel-${slug}`}
        tabIndex={selected ? 0 : -1}
        className={selected ? 'active' : ''}
        onClick={() => onChange(item)}
        onKeyDown={(event) => onKeyDown(event, index)}
      >{item}</button>;
    })}
  </div>;
}

export function TabPanel({ tab, active, idPrefix, children }: { tab: string; active: string; idPrefix: string; children: React.ReactNode }) {
  if (tab !== active) return null;
  const slug = tab.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return <div role="tabpanel" id={`${idPrefix}-panel-${slug}`} aria-labelledby={`${idPrefix}-tab-${slug}`} tabIndex={0}>{children}</div>;
}
