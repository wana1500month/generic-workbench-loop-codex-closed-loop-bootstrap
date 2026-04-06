FROM mcr.microsoft.com/playwright:v1.59.1-jammy

RUN BROWSER_PATH="$(find /ms-playwright -path '*chrome-linux/chrome' | head -n1)" \
  && if [ -n "$BROWSER_PATH" ]; then ln -sf "$BROWSER_PATH" /usr/bin/chromium; fi

WORKDIR /workspaces/generic-workbench-loop
