# Contributing to hono-ban

Thank you for your interest in contributing to hono-ban. This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

This project adheres to a Code of Conduct that all participants are expected to follow. By participating, you are expected to uphold this code.

## Development Process

1. Fork the repository
2. Create a new branch for your feature or fix
3. Write code and tests
4. Ensure all tests pass: `bun test`
5. Submit a pull request

## Pull Request Process

1. Update the README.md with details of significant changes
2. Update the package version following [SemVer](https://semver.org/)
3. Ensure all tests pass and code coverage is maintained
4. The PR will be merged once you have the sign-off of at least one maintainer

## Coding Standards

- Write code in TypeScript
- Maintain type safety - avoid using `any`
- Follow existing code style and formatting
- Document public APIs using JSDoc comments
- Write unit tests for new functionality
- Maintain or improve code coverage

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
feat: add new error formatter
fix: correct status code handling
docs: update API documentation
test: add test for error sanitization
```

## Testing

- Write unit tests for new features
- Run tests using `bun test`
- Check coverage with `bun test --coverage`
- Test both ESM and CommonJS builds

## Documentation

- Update relevant documentation for any changes
- Include JSDoc comments for public APIs
- Add examples for new features
- Keep the README.md up to date

## Development Setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Build the project:

   ```bash
   bun run build
   ```

3. Run tests:
   ```bash
   bun test
   ```

## Reporting Issues

When reporting issues, please include:

- A clear description of the issue
- Steps to reproduce
- Expected behavior
- Actual behavior
- Version information
- Any relevant code samples or error messages

## Feature Requests

Feature requests are welcome. Please provide:

- Clear description of the feature
- Use cases and benefits
- Potential implementation approach
- Impact on existing functionality

## License

By contributing to hono-ban, you agree that your contributions will be licensed under the MIT License.
