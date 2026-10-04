# Changelog

## 0.5.3

- Rebuilt both icon sizes from the complete original DaCode artwork without cropping.
- Added integrity tests that reject truncated PNG assets before packaging.

## 0.5.2

- Changed the Marketplace display name to `DaCode Language by Pomni` because the removed `DaCode` listing still reserves that display name.

## 0.5.1

- Fixed VSIX exclusions so the GitHub client is no longer bundled locally.
- Added packaging guards that fail CI if remote client code leaks into the VSIX.
- Kept the corrected compact DaCode file icon and Marketplace icon.

# Changelog

## 0.5.0

- Rebuilt the extension as a thin GitHub bootstrap.
- VS Code client behavior, language service, DaCode spec and JS runtime are now synchronized together from one GitHub revision.
- Added cached offline fallback for the full GitHub client revision.
- Added dedicated compact file icon and a separate Marketplace icon based on the original DaCode DC logo.

# Changelog

## 0.4.2

- Moved the Marketplace identity to `pomni-org.dacode-programming-language` because the removed `pomni-org.dacode-language` identity is permanently reserved by the Marketplace.
- This is a fresh Marketplace listing; future updates can use the normal update flow.

# Changelog

## 0.4.0

- Simplified declarations: `remem name():` for functions, `remem Name:` for classes, `remem name = value` for variables.
- Added multiline comments with `""" ... """`.
- Added the DaCode logo as the Marketplace extension icon and default `.dc` language icon.
- Added block-comment editor support and semantic highlighting.

# Changelog

## 0.2.0

- Added thin GitHub-synchronized DaCode language client.
- Added dynamic syntax highlighting, completion and hover from `spec.json`.
- Added top-bar Run button for `.dc` files.
- Added runtime download/cache from `pomni-org/DaCode`.
- Added offline fallback to the last successfully synchronized revision.
