# Contributing

This project is shared **as is**. Pull requests are welcome; there is no promise of response times, and the method changes with the needs of the people who use it, so a PR may be declined or reshaped.

Before opening a pull request, run the three tests:

```bash
claude plugin test .
python3 -m unittest discover -s tests -p '*_test.py'
bash tests/cleanup_test.sh
```

Keep a change small and say what problem it solves. Questions and ideas: GitHub Discussions.
