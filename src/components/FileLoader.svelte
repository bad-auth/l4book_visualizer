<script lang="ts">
  let { onSelect }: { onSelect: (file: File) => void } = $props();
  let inputEl: HTMLInputElement;

  function handleChange() {
    const file = inputEl?.files?.[0];
    if (file) onSelect(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) onSelect(file);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="drop-zone" ondrop={handleDrop} ondragover={handleDragOver} onclick={() => inputEl.click()}>
  <input bind:this={inputEl} type="file" accept=".json" onchange={handleChange} hidden />
  <div class="label">Drop snapshot JSON here or click to browse</div>
  <div class="hint">Expects L4 book snapshot format</div>
</div>

<style>
  .drop-zone {
    border: 2px dashed var(--border);
    border-radius: 8px;
    padding: 48px 64px;
    cursor: pointer;
    text-align: center;
    transition: border-color 0.15s;
  }

  .drop-zone:hover {
    border-color: var(--accent);
  }

  .label {
    font-size: 14px;
    color: var(--text);
    margin-bottom: 8px;
  }

  .hint {
    font-size: 11px;
    color: var(--text-dim);
  }
</style>
