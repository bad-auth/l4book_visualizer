<script lang="ts">
  type Option = { value: string; label: string };

  let {
    options,
    value = $bindable(''),
    placeholder = 'Search...',
    disabled = false,
    compact = false,
    onSelect,
  }: {
    options: Option[];
    value: string;
    placeholder?: string;
    disabled?: boolean;
    compact?: boolean;
    onSelect?: (value: string) => void;
  } = $props();

  let query = $state('');
  let open = $state(false);
  let highlightIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state(undefined);
  let listEl: HTMLUListElement | undefined = $state(undefined);

  let filtered = $derived(
    query
      ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
      : options,
  );

  // Keep highlight in bounds when filtered list changes
  $effect(() => {
    if (highlightIndex >= filtered.length) {
      highlightIndex = Math.max(0, filtered.length - 1);
    }
  });

  function select(opt: Option) {
    value = opt.value;
    query = opt.label;
    open = false;
    onSelect?.(opt.value);
  }

  // Sync displayed text when value changes externally
  $effect(() => {
    const match = options.find((o) => o.value === value);
    if (match && !open) {
      query = match.label;
    }
  });

  function handleFocus() {
    if (disabled) return;
    open = true;
    query = '';
    highlightIndex = 0;
  }

  function handleInput() {
    open = true;
    highlightIndex = 0;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        open = true;
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightIndex = Math.min(highlightIndex + 1, filtered.length - 1);
      scrollToHighlighted();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
      scrollToHighlighted();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlightIndex]) {
        select(filtered[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      open = false;
      // Restore displayed text to current selection
      const match = options.find((o) => o.value === value);
      if (match) query = match.label;
    }
  }

  function scrollToHighlighted() {
    requestAnimationFrame(() => {
      const item = listEl?.children[highlightIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    });
  }

  function handleBlur(e: FocusEvent) {
    // If focus moved to something inside our component, don't close
    const related = e.relatedTarget as HTMLElement | null;
    if (related && (listEl?.contains(related) || inputEl?.contains(related))) return;
    open = false;
    const match = options.find((o) => o.value === value);
    if (match) query = match.label;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="dropdown" class:compact onblur={handleBlur}>
  <input
    bind:this={inputEl}
    class="dropdown-input"
    type="text"
    bind:value={query}
    {placeholder}
    {disabled}
    onfocus={handleFocus}
    oninput={handleInput}
    onkeydown={handleKeydown}
  />
  {#if open && filtered.length > 0}
    <ul class="dropdown-list" bind:this={listEl}>
      {#each filtered as opt, i}
        <li
          class="dropdown-item"
          class:highlighted={i === highlightIndex}
          role="option"
          aria-selected={i === highlightIndex}
          tabindex="-1"
          onmousedown={(e: MouseEvent) => { e.preventDefault(); select(opt); }}
          onmouseenter={() => (highlightIndex = i)}
        >
          {opt.label}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .dropdown {
    position: relative;
    width: 100%;
  }

  .dropdown-input {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: inherit;
    font-size: 13px;
    border-radius: 4px;
  }

  .dropdown-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .dropdown-input::placeholder {
    color: var(--text-dim);
  }

  .dropdown-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dropdown-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 100;
    max-height: 200px;
    overflow-y: auto;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-top: none;
    border-radius: 0 0 4px 4px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .dropdown-item {
    padding: 6px 12px;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
  }

  .dropdown-item.highlighted {
    background: var(--accent);
    color: #000;
  }

  /* Compact variant for header inline use */
  .compact {
    width: auto;
    display: inline-block;
    vertical-align: baseline;
  }

  .compact .dropdown-input {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    padding: 2px 4px;
    width: 100px;
    text-align: center;
  }

  .compact .dropdown-input:hover {
    border-color: var(--border);
  }

  .compact .dropdown-input:focus {
    border-color: var(--accent);
    background: var(--bg);
  }

  .compact .dropdown-list {
    min-width: 140px;
  }

  .compact .dropdown-item {
    font-size: 12px;
    padding: 4px 10px;
  }
</style>
