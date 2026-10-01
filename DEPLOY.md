# Publishing Grapher (GitHub Pages)

Nothing is published until you do the two steps below. The workflow
`.github/workflows/deploy-pages.yml` runs **only** when you start it by hand;
pushing to `main` does not deploy anything.

## One-time setup

1. Open <https://github.com/gokhankelebek/grapher/settings/pages>.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

## Each time you want to publish

1. Push your commits to `main` as usual.
2. Open <https://github.com/gokhankelebek/grapher/actions/workflows/deploy-pages.yml>.
3. Press **Run workflow** (branch `main`) → **Run workflow**.
4. When both jobs are green (about 2 minutes), the site is live at:

   **https://gokhankelebek.github.io/grapher/**

The workflow runs the test suite first and stops if anything fails.

## What students get

- **Share links** (Document menu → Share link…) made from the published site
  open for anyone, with no account. The graph travels inside the link (after
  the `#`), so nothing is uploaded and nothing reaches the server.
  Links made from `localhost` only work on your own computer.
- **Offline / install**: after one visit the app opens with no network.
  Chrome/Edge show an *Install* icon in the address bar; on iPad use
  Share → *Add to Home Screen*.
- Each student's documents live in their own browser (localStorage), exactly
  as yours do.

## Building it yourself

```sh
GRAPHER_BASE=/grapher/ npm run build            # dist/ for the /grapher/ path
GRAPHER_BASE=/grapher/ npx vite preview          # http://localhost:4173/grapher/
npm run build                                    # dist/ for a site at /
```

`npm run dev` always serves at `/`. The service worker is registered only in
production builds. To undo publishing, set Pages → Source back to *None*.
