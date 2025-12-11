export function subtractWorkingDays(dayjsInstance, workingDays) {
    let daysToSubtract = Number(workingDays) || 0;
    let cursor = dayjsInstance.clone(); // استفاده از clone برای جلوگیری از تغییر instance اصلی
    while (daysToSubtract > 0) {
        cursor = cursor.subtract(1, 'day');
        const day = cursor.day(); // 0 = Sunday, 6 = Saturday
        if (day !== 0 && day !== 6) {
            daysToSubtract -= 1;
        }
    }
    return cursor;
}
