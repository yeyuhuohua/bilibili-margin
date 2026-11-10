# Settings UI references

The categorized settings structure comes from Schallophy's PR #135. Its icon-led sidebar and selected-tab motion reference these 21st components:

- [Settings Sidebar Layout](https://21st.dev/@felipemenezes098/components/settings-2) by felipemenezes098.
- [Animated Tabs](https://21st.dev/@educalvolpz/components/animated-tabs) by educalvolpz.

The implementation uses MARGIN's existing native DOM, locally bundled IconMCP outlines, theme tokens and reduced-motion preferences. The selected-tab indicator animates only its transform for 280 ms. No React, shadcn or Motion runtime packages are added.
