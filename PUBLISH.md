# Publishing `@topcal/cli`

Public package on the `topcal` npm org. Repo: [bcharleson/topcal-cli](https://github.com/bcharleson/topcal-cli).

```bash
npm login
pnpm install
pnpm build && pnpm test
npm publish --access public
```

If an older private `0.1.0` exists, make the package **public** in the npm UI first, then publish `0.1.1+`.

`PUBLISH.md` is not included in the npm tarball — only `README.md`, `bin/`, and `dist/` ship to the registry.
