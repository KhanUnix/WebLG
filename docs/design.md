# Material Studio design

## Summary

The screen is a material workbench for developers and designers: compare glass
over real imagery, tune one component and reuse the result. Movable glass surfaces cross photographic and calibration backgrounds. The surrounding interface stays quiet. This is a web application
inspired by Apple's design principles, not a native Apple framework or a claim
of identical rendering.

## Design system

The system stack provides text and controls; the only serif is illustrative
lettering in the calibration background. UI font sizes use rem, preserving
browser text preferences. Display type is restrained to the page title and
panel heading. Controls use regular, medium and semibold weights.

| Role      | Light     | Dark      |
| --------- | --------- | --------- |
| Page      | `#f5f5f7` | `#151517` |
| Surface   | `#ffffff` | `#202023` |
| Content   | `#1d1d1f` | `#f5f5f7` |
| Secondary | `#626267` | `#a3a3ad` |
| Accent    | `#0066cc` | `#78b7ff` |
| Separator | `#dedee3` | `#38383d` |

An explicit appearance selector switches between the light and dark palettes. The stage has separate material fills
and monochrome ink; one primary action uses a blue fill. Glass uses a
transparent one-pixel border so the optical highlight is not covered by the
DOM fill. The content backgrounds themselves do not use glass.

Computed sRGB contrast ratios are in [design-contrast.json](design-contrast.json).
Image backgrounds vary, so these token ratios do not constitute a pixel-level
contrast audit of arbitrary imported images. Strong functional fills, a
caption scrim and an opaque accessibility mode provide the readable paths.

On regular widths the scene occupies the flexible left pane, and the
296-pixel inspector occupies the right pane. Below 850 pixels the inspector
moves below the scene; below 540 pixels its settings form one column. All
functions remain available. The scene grows with root text size and the
movable panel is constrained on resize. It reserves space for the lower
navigation rather than covering it.

## Interaction principles

- Glass belongs to the functional layer: panels, controls, navigation and menus.
  Photographs, textures and geometric drawings remain content backgrounds.
- Background movement is optional and starts stopped. Reduced motion suppresses
  automatic decorative motion and animated refraction. Explicit playback remains
  available through the decor switch.
- Keyboard alternatives accompany dragging: Arrow keys move surfaces and Home
  recenters them. Native range and checkbox controls retain keyboard behaviour.
  Focus remains visible and menus restore it to their trigger.
- Layout follows available width, preserves safe-area padding and supports text
  enlargement. Mobile action targets and slider/switch hit regions are 44 pixels.
- Colour identifies primary actions, selection and status. System typography
  and consistent spacing keep the surrounding interface restrained.

HTML controls, ARIA, CSS media queries and GPU composition provide these
behaviours in the browser.

## Interaction and accessibility review

The image selector and optical presets expose explicit selected states; colour
is supplemented by borders, checkmarks, weight or native checked state.
Labels describe actions rather than implementation. Menus constrain themselves
to the scene, skip disabled items and support Arrow/Home/End/Escape/Tab.
The inspector pairs ranges with editable numeric values. Local image import
has a file-picker alternative to drag-and-drop.

Reduced Transparency, increased contrast and forced colours get opaque
surfaces. The manual transparency switch covers browsers that do not expose
that preference. Comparison mode does not override accessibility opacity.
The system setting takes precedence over the manual control. Feedback has an
explicit dismiss action and is announced through a live status region.

The composition stays idle until something changes. Following a CSS
transition briefly is separate from continuously animating the backdrop;
animation stops while the page is hidden. The first shader compilation can
still introduce a one-time delay when an optical shader variant is first used.

## Backgrounds

Photographic, textured, geometric and mixed backgrounds expose different optical
behaviours. Optional movement helps inspect refraction over changing detail.
Shared control shapes, spacing, icon strokes and typography connect the demo
to the component library.

## Verification and limits

Automated checks cover the native interaction paths, core optical regression,
directional highlights, explicit square radii, GPU layer sampling, keyboard
operation, responsive bounds, 200% root text size, system appearance,
accessibility opacity and a WebGL-unavailable touch path. Desktop and mobile
screenshots are inspected during implementation.

Browser checks use Chromium/SwiftShader on the VM. They do not certify
VoiceOver, Safari, Firefox or physical-device performance. The API guide also
states that native HTML labels stay sharp: arbitrary DOM content is not
rasterized or refracted by the stage.
