import { h, setMarkup } from './dom';

// The drawer's 340 × 272 silhouette. The space grid uses the same outlines at its own aspect ratio.
export const FOLDER_BACK = 'M0 56A22 22 0 0 1 22 34H146C170 34 172 0 198 0H318A22 22 0 0 1 340 22V250A22 22 0 0 1 318 272H22A22 22 0 0 1 0 250Z';
const edge = 'M0 22A22 22 0 0 1 22 0H118C144 0 146 32 172 32H318A22 22 0 0 1 340 54';
const foot = 'V176A22 22 0 0 1 318 198H22A22 22 0 0 1 0 176Z';
const face = edge + foot;
const lip = edge + 'v14a22 22 0 0 0-22-22H172c-26 0-28-32-54-32H22A22 22 0 0 0 0 36Z';
const paper = 'M0 36A22 22 0 0 1 22 14H118C144 14 146 46 172 46H318A22 22 0 0 1 340 68' + foot;
const NS = 'http://www.w3.org/2000/svg';
// Some engines accept the URL syntax but cannot sample a backdrop through an SVG filter.
const canRefract = /(?:Chrome|Chromium)\//.test(navigator.userAgent)
  && CSS.supports('backdrop-filter', 'url(#gf-prism)') && CSS.supports('mask-image', 'url(#gf-pocket-mask)');
let skinTemplate: SVGSVGElement | undefined;

/** Fragment URLs resolve in the card's own tree. Install once there, never per cover/resize. */
export function ensureFolderPocket(node: Node): void {
  const tree = node.getRootNode();
  if (!(tree instanceof ShadowRoot || tree instanceof Document) || tree.getElementById('gf-pocket-defs')) return;
  const defs = document.createElementNS(NS, 'svg');
  defs.id = 'gf-pocket-defs';
  defs.setAttribute('width', '0'); defs.setAttribute('height', '0'); defs.setAttribute('aria-hidden', 'true');
  defs.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden';
  // A shallow bevel acts as a prism. The source is the real backdrop (including an unfolded file), not a second image.
  setMarkup(defs, `<defs>
    <clipPath id="gf-pocket-back" clipPathUnits="objectBoundingBox"><path transform="scale(${1 / 340} ${1 / 272})" d="${FOLDER_BACK}"/></clipPath>
    <clipPath id="gf-pocket-face" clipPathUnits="objectBoundingBox"><path transform="scale(${1 / 340} ${1 / 198})" d="${face}"/></clipPath>
    <mask id="gf-pocket-mask" x="0" y="0" width="1" height="1" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox"><path transform="scale(${1 / 340} ${1 / 68})" fill="white" d="${lip}"/></mask>
    <linearGradient id="gf-pocket-density" x2="0" y2="1"><stop stop-color="white" stop-opacity=".4"/><stop offset=".17" stop-color="white" stop-opacity=".8"/><stop offset=".34" stop-color="white"/></linearGradient>
    <mask id="gf-pocket-shoulder" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#gf-pocket-density)"/></mask>
    <linearGradient id="gf-pocket-polish" x2=".22" y2="1"><stop stop-color="white" stop-opacity=".17"/><stop offset=".5" stop-color="white" stop-opacity=".025"/><stop offset="1" stop-color="black" stop-opacity=".035"/></linearGradient>
    ${canRefract ? '<filter id="gf-prism" color-interpolation-filters="sRGB"><feOffset dx="3" dy="-2"/></filter>' : ''}
  </defs>`);
  (tree instanceof Document ? tree.body : tree).append(defs);
}

/** Inert skin only; the drawer and the personal-space card keep their own controls and semantics. */
export function folderPocketLayers(): Node[] {
  if (!skinTemplate) {
    const skin = document.createElementNS(NS, 'svg');
    skin.setAttribute('class', 'gf-rim gf-front-rim'); skin.setAttribute('aria-hidden', 'true');
    skin.setAttribute('viewBox', '0 0 340 198'); skin.setAttribute('preserveAspectRatio', 'none');
    setMarkup(skin, `<path class="gf-edge-tint" d="${lip}"/><g class="gf-plate"><path class="gf-paper" d="${paper}"/><path class="gf-polish" fill="url(#gf-pocket-polish)" d="${paper}"/></g>
      <path class="gf-hem" transform="translate(0 14)" d="${edge}"/><path class="gf-outline" d="${face}"/>`);
    skinTemplate = skin;
  }
  return [h('span', { class: `gf-lip${canRefract ? ' gf-lip--prism' : ''}`, 'aria-hidden': 'true' }), skinTemplate.cloneNode(true)];
}
