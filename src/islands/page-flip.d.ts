/**
 * Minimal types for `page-flip` (StPageFlip), which ships JavaScript only.
 *
 * Only the surface this project actually calls is declared. Adding a method
 * here is a deliberate act — it keeps the island honest about how much of a
 * third-party library it depends on.
 */
declare module 'page-flip' {
  export interface PageFlipSettings {
    width: number;
    height: number;
    size?: 'fixed' | 'stretch';
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    maxShadowOpacity?: number;
    showCover?: boolean;
    usePortrait?: boolean;
    mobileScrollSupport?: boolean;
    flippingTime?: number;
    useMouseEvents?: boolean;
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: PageFlipSettings);
    loadFromHTML(items: NodeListOf<HTMLElement> | HTMLElement[]): void;
    turnToPage(page: number): void;
    flipNext(): void;
    flipPrev(): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    update(): void;
    destroy(): void;
    on(event: 'flip' | 'changeState' | 'changeOrientation', cb: (e: { data: number }) => void): void;
  }
}
