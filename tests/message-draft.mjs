/** 浏览器编辑区的用户可见文本，表情按原生发送标记计算。 */
export const draftValue = locator => locator.evaluate(el => {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('img[data-message-emote]').forEach(image => image.replaceWith(image.alt));
  copy.querySelectorAll('br[data-message-break]').forEach(br => br.replaceWith('\n'));
  return copy.textContent.replace(/\u00a0/g, ' ');
});

export const selectDraftText = (locator, start, end) => locator.evaluate((el, offsets) => {
  const range = document.createRange(); range.setStart(el.firstChild, offsets[0]); range.setEnd(el.firstChild, offsets[1]);
  const selection = el.getRootNode().getSelection?.() || document.getSelection();
  selection.removeAllRanges(); selection.addRange(range); el.dispatchEvent(new Event('select'));
}, [start, end]);
