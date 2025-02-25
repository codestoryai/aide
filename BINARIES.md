# Binaries in AIDE Project

## Current State

The AIDE project currently uses binaries that are hosted in a separate GitHub repository: [codestoryai/binaries](https://github.com/codestoryai/binaries). These binaries are referenced in several places within the codebase, particularly in the remote extensions (SSH and WSL), where they are downloaded from URLs like:

```
https://github.com/codestoryai/binaries/releases/download/${version}.${release}/aide-reh-${os}-${arch}-${version}.${release}.tar.gz
```

## Transparency Concerns

There are some transparency concerns regarding how these binaries are built and distributed:

1. The build scripts or processes for creating these binaries are not documented within the main repository
2. There is no clear documentation on how these binaries are created, verified, or published
3. The standard practice for open source projects is to have build scripts and processes within the main repository for transparency

## Recommended Improvements

To improve transparency and follow best practices for open source projects, the following improvements are recommended:

1. Include build scripts for binaries within the main repository
2. Document the binary build process in detail
3. Provide information on how binaries are verified for security
4. Consider moving binary artifacts into the main repository or providing clear documentation on the separate repository

## Current References

The following files in the repository reference the external binaries repository:

- [`extensions/open-remote-wsl/src/serverSetup.ts`](extensions/open-remote-wsl/src/serverSetup.ts)
- [`extensions/open-remote-wsl/package.json`](extensions/open-remote-wsl/package.json)
- [`extensions/open-remote-ssh/src/serverSetup.ts`](extensions/open-remote-ssh/src/serverSetup.ts)
- [`extensions/open-remote-ssh/package.json`](extensions/open-remote-ssh/package.json)
- [`README.md`](README.md) (for version badge)

## Next Steps

This documentation serves as a starting point for addressing the transparency concerns. The development team should consider:

1. Adding detailed documentation about the binary build process
2. Including build scripts in the main repository
3. Providing a clear explanation of why binaries are in a separate repository, if this approach is maintained