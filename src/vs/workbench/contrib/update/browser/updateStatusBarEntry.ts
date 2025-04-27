import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';

export function isUpdateAvailable(): boolean {
    // Temporary simulation: always return True to show the update notification
    return true;
}

export class UpdateStatusBarEntry extends Disposable {
    private readonly entry: IStatusbarEntryAccessor;

    constructor(
        @IStatusbarService private readonly statusbarService: IStatusbarService
    ) {
        super();

        this.entry = this._register(this.createStatusBarEntry());
        this.updateStatusBar();
    }

    private createStatusBarEntry(): IStatusbarEntryAccessor {
        const entry: IStatusbarEntry = {
            name: 'Update Status',
            text: '',
            ariaLabel: 'Update Status',
            tooltip: 'Click to check for updates',
            command: 'update.check'
        };

        return this.statusbarService.addEntry(entry, 'status.update', StatusbarAlignment.RIGHT, 100);
    }

    private updateStatusBar(): void {
        if (isUpdateAvailable()) {
            this.entry.update({
                name: 'Update Status',
                text: '\u{1F6A8} NEW UPDATE AVAILABLE',  // Using an alert emoji
                ariaLabel: 'New update available',
                tooltip: 'Click to check for updates',
                command: 'update.check',
                color: '#ff0000'  // Red color for emphasis
            });
        }
    }
}