# Blindspot

Finds the risky code in a pull request that no test covers, using Claude.

Blindspot is a small Windows app. You pick a GitHub pull request; Claude reads the changes and the tests that came with them, and lists the behaviour that could break without any test noticing. Each gap comes with the specific test cases to write and a suggestion for where they belong.

Blindspot is free and open source, from [Goodhope Technologies](https://goodhopetechnologies.com).

## What it does

- **Reads the change and its tests together.** It separates source files from test files and works out which new behaviour the tests in the pull request exercise.
- **Reports only gaps that matter.** Branches, boundaries, error handling, concurrency, money, permissions and data changes. It ignores renames, formatting, configuration and generated files.
- **Says exactly what to test.** Each gap lists concrete cases: the input or situation, and the result to assert.
- **Knows your layout.** It looks at the test files already in the repository, so it can point to the existing file a test belongs in, or suggest a new one that follows your naming.
- **Gives you a checklist.** Copy the gaps as a Markdown checklist, or post them as a comment on the pull request. Nothing is posted unless you choose to.

## Install

Download the latest `.msi` from the [Releases](../../releases) page and run it. Windows 10 or later, 64-bit.

The installer is not code-signed yet, so Windows SmartScreen will warn that the publisher is unknown. Choose **More info**, then **Run anyway**.

## Set up

Blindspot needs two keys, entered on the Settings screen:

1. **An Anthropic API key**, from <https://console.anthropic.com/settings/keys>. Each run is billed to this key.
2. **A GitHub fine-grained access token**, from <https://github.com/settings/personal-access-tokens/new>, with these repository permissions:
   - Contents: read
   - Pull requests: read (or read and write, if you want to post comments)

Both are encrypted on your computer using Windows' own credential protection.

## Privacy

Blindspot has no server. The app talks to two services only:

- **GitHub**, to read pull requests and the list of file names in the repository, and to post the comments you ask for.
- **Anthropic**, to which it sends the pull request's title, description and changed lines, plus the names of the repository's test files, so Claude can find the gaps.

## Limits

- GitHub only, for now.
- It sees only the lines a pull request changes. A test that already exists in a file the pull request did not touch is invisible to it, so check each gap before writing the test.
- It does not run your tests or measure coverage. It reasons about the code.
- Very large pull requests are trimmed, and the files left out are listed.
- Claude can be wrong. Treat the list as a prompt for your own judgement.

## Build from source

```
npm install
npm test
npm start        # run the app
npm run dist     # build the MSI (Windows only)
```

Running the "Build installer" workflow on GitHub Actions builds the MSI and attaches it to a release named after the version in `package.json`.

## Licence

MIT. See [LICENSE](LICENSE).
