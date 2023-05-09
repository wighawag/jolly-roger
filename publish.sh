#!/usr/bin/env bash
git checkout public && git merge dev && git push && git checkout dev && git push
