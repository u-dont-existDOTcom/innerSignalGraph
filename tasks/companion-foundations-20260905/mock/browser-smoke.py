"""Optional Playwright check of the generated, fictional-only preview.

Usage: python browser-smoke.py preview.html --browser /usr/bin/chromium --out /tmp/preview-check
Injects the exact generated HTML with set_content; no hosted service or personal data.
Does not add Playwright to repository dependencies or claim file:// navigation coverage.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('html', type=Path)
    parser.add_argument('--browser', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    html = args.html.read_text(encoding='utf-8')
    args.out.mkdir(parents=True, exist_ok=True)
    checks = []

    def check(condition, name):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.browser, headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1400, 'height': 1100})
        requests, errors, console_errors = [], [], []
        page = context.new_page()
        page.on('request', lambda request: requests.append(request.url))
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
        page.set_content(html)
        check(page.locator('#history').is_checked() is False, 'History is opt-in')
        check(page.locator('#reading').is_hidden(), 'No opening progress claim')
        page.click('#review')
        check(page.locator('#reading').is_hidden(), 'Review without history abstains')
        page.click('#inner-invite')
        check('No unsolicited' in page.locator('#inner-result').inner_text(), 'Unset invitation respected')
        page.select_option('#inner-pref', 'welcome')
        page.click('#inner-invite')
        check('could be offered' in page.locator('#inner-result').inner_text(), 'Welcomed relevant invitation demonstrated')
        page.click('#inner-invite')
        check('No repeated' in page.locator('#inner-result').inner_text(), 'No repeated invitation')
        page.select_option('#spirit-pref', 'do_not_suggest')
        page.click('#spirit-invite')
        check('No unsolicited' in page.locator('#spirit-result').inner_text(), 'Spiritual refusal independent')
        page.click('#spirit-request')
        check(page.locator('#spirit-pref').input_value() == 'do_not_suggest', 'Current request leaves ongoing preference unchanged')
        check('conversation only' in page.locator('#spirit-result').inner_text(), 'Current permission explicitly bounded')
        page.check('#history')
        page.select_option('#scenario', 'mixed')
        page.click('#review')
        check(page.locator('#reading').is_visible(), 'Mixed reflection rendered')
        check('not call this simply better' in page.locator('#reading-text').inner_text(), 'Mixed interpretation not flattering by default')
        check('m3' in page.locator('#reading-sources').inner_text(), 'Counterevidence is cited')
        page.screenshot(path=str(args.out / 'desktop.png'), full_page=True)
        page.click('#withdraw-m3')
        check(page.locator('#reading').is_hidden(), 'Withdrawal clears old interpretation')
        check(page.locator('#reading-text').inner_text() == '', 'Withdrawn interpretation removed from DOM, not just hidden')
        check(page.locator('#reading-sources').inner_text() == '', 'Stale source references removed')
        check(page.evaluate('document.activeElement.id') == 'notice', 'Focus recovered after source removal')
        page.click('#review')
        check(page.locator('#reading').is_hidden(), 'No reuse after counterevidence withdrawal')
        page.select_option('#scenario', 'natural')
        page.select_option('#scenario', 'mixed')
        check(page.locator('#withdraw-m3').count() == 0, 'Withdrawal persists across scenario switching')
        page.locator('details.scenario-line > summary').click()
        page.click('#reset')
        page.click('#review')
        check(page.locator('#reading').is_visible(), 'Explicit fictional reset works')
        page.click('#confirm')
        check('does not make' in page.locator('#feedback').inner_text(), 'Agreement is not promoted to fact')
        page.click('#reject')
        page.click('#review')
        check(page.locator('#reading').is_hidden(), 'Rejected reading stays withdrawn')
        page.select_option('#scenario', 'natural')
        page.click('#review')
        check('through your friends' in page.locator('#reading-text').inner_text(), 'Natural growth credited outside therapy')
        page.uncheck('#history')
        check(page.locator('.report').count() == 0 and page.locator('#reading-text').inner_text() == '', 'Disabling history removes active reports and reflection')
        page.check('#history')
        page.select_option('#reflection-pref', 'off')
        page.click('#review')
        check(page.locator('#reading').is_hidden(), 'Off stays off despite review button')
        page.select_option('#scenario', 'boundaries')
        page.select_option('#reflection-pref', 'on_request')
        page.click('#opportunity')
        check(page.locator('#reading').is_hidden(), 'On-request blocks unsolicited opportunity')
        page.select_option('#reflection-pref', 'occasional')
        page.click('#opportunity')
        check(page.locator('#reading').is_visible(), 'Occasional permits one opportunity')
        page.click('#opportunity')
        check(page.locator('#reading').is_hidden(), 'Repeated opportunity abstains')
        page.click('#review')
        check(page.locator('#reading').is_visible(), 'Explicit rereview remains possible')
        for scenario in ['missing', 'repeated']:
            page.select_option('#scenario', scenario)
            page.click('#review')
            check(page.locator('#reading').is_hidden(), f'{scenario}: no fabricated longitudinal change')
        page.click('#practice')
        check('someone you love' in page.locator('#support-text').inner_text(), 'Optional self-guidance example')
        page.click('#practice')
        check('without proving' in page.locator('#support-text').inner_text(), 'Questions do not loop')
        page.click('#direct')
        check('without proving' in page.locator('#support-text').inner_text(), 'Concrete help available without question')
        page.click('#exit')
        check(page.locator('#active').is_hidden() and page.locator('#ended').is_visible(), 'Exit is unconditional')
        check(page.locator('#reading-text').inner_text() == '' and page.locator('#support-text').inner_text() == '', 'Exit clears hidden conversation content')
        check(page.evaluate('document.activeElement.id') == 'ended-title', 'Exit focus lands on confirmation')
        page.click('#reopen')
        check(not page.locator('#history').is_checked() and page.locator('#spirit-pref').input_value() == 'unset', 'New session has no inherited consent')
        check(page.evaluate('document.activeElement.id') == 'workspace', 'Restart focus restored')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.check('#history')
        page.select_option('#scenario', 'mixed')
        page.click('#review')
        check(page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile has no horizontal overflow')
        page.screenshot(path=str(args.out / 'mobile.png'), full_page=True)
        check(page.evaluate('new Set([...document.querySelectorAll("[id]")].map(e => e.id)).size === document.querySelectorAll("[id]").length'), 'DOM IDs are unique')
        check(not requests, 'No page-initiated network requests')
        check(not errors and not console_errors, 'No JavaScript or CSP console errors')
        report = {'kind': 'synthetic-ui-smoke', 'passed': len(checks), 'checks': checks,
                  'browser': browser.version, 'rendering': 'set_content(exact_generated_html)',
                  'fileSchemeNavigationTested': False, 'modelEvaluated': False,
                  'networkRequests': requests, 'pageErrors': errors, 'consoleErrors': console_errors,
                  'viewports': ['1400x1100', '390x844']}
        (args.out / 'browser-results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, indent=2))
        browser.close()


if __name__ == '__main__':
    main()
