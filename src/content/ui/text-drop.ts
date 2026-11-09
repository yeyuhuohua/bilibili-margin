/** 搜索入口接收拖入的文字，文件继续由各自的上传入口处理。 */
export function acceptTextDrop(el: HTMLElement, receive: (text: string) => void): void {
  const accepts = (e: DragEvent) => e.dataTransfer?.types.includes('text/plain') && !e.dataTransfer.types.includes('Files');
  el.addEventListener('dragover', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });
  el.addEventListener('drop', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const text = e.dataTransfer!.getData('text/plain').trim();
    if (text) receive(text);
  });
}
