# Listening visuals

The listening-mode visualizer adapts the Canvas bars, radial spokes, grid, line and dots from **Audio Visualizer** by **aadixc0de / chatcn**, retrieved through 21st.dev and supplied by the user. Its shapes and smoothing are adapted to MARGIN's live FFT samples and shared frame loop. [Component source](https://21st.dev/@aadixc0de/components/audio-visualizer)

The visualizer uses the extension's native TypeScript and Canvas implementation with live audio analysis from the current video. The listening surface reuses MARGIN's existing page background renderer and settings.

The redesigned view selector references the sliding-indicator composition of **Segmented Tabs** by **micka_design**. It uses native CSS transitions and the existing tab keyboard behavior. [Design reference](https://21st.dev/@micka_design/components/tabs-base)

The playback dock references the isolated lens layer and soft reflections of **Apple Tahoe Liquid Glass Button** by **jahed**. Its optics use MARGIN's existing glass renderer, with readable controls above the lens. [Design reference](https://21st.dev/@jahed/components/apple-tahoe-liquid-glass-button)

The desktop composition references **Cider Immersive**, with large artwork, side-by-side lyrics and a horizontal transport. [Design reference](https://cider.sh/)

Active-line hierarchy and lyric following reference the **AMLL Playground**. MARGIN uses its existing caption and LRC handling with native browser scrolling. [Design reference](https://amll.dev/playground/)

The staggered entrance and lyric easing reference **Synced Lyric Captions** by **moumensoliman** on 21st.dev, implemented with CSS and the Web Animations API. [Design reference](https://21st.dev/@moumensoliman/components/synced-lyric-captions-shadcnui)
