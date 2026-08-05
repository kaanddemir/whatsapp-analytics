"""Test package.

Making tests a package is what lets a bare `pytest` import `app`: pytest walks
up past the __init__.py files to find the import root, lands on the project
root, and puts that on sys.path.
"""
