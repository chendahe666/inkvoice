package org.inkvoice.keyboard

/** Pure input-session policy. A result from a hidden or previous editor cannot be committed. */
class SessionGuard {
    data class Ticket(val generation: Long, val packageName: String, val fieldId: Int)
    private var generation = 0L
    private var packageName = ""
    private var fieldId = 0
    private var allowed = false
    private var visible = false

    fun startInput(packageName: String, fieldId: Int, inputType: Int) {
        generation++
        this.packageName = packageName
        this.fieldId = fieldId
        allowed = inputType != 0 && !InputPolicy.isSensitive(inputType)
        visible = false
    }
    fun show() { visible = true }
    fun invalidate() { generation++ }
    fun selectionChanged(oldStart: Int, oldEnd: Int, newStart: Int, newEnd: Int): Boolean {
        if (oldStart == newStart && oldEnd == newEnd) return false
        invalidate()
        return true
    }
    fun hide() { visible = false; invalidate() }
    fun ticket(): Ticket? = if (visible && allowed) Ticket(generation, packageName, fieldId) else null
    fun canCommit(ticket: Ticket): Boolean = visible && allowed && ticket.generation == generation &&
        ticket.packageName == packageName && ticket.fieldId == fieldId
}

object InputPolicy {
    fun isSensitive(inputType: Int): Boolean {
        val inputClass = inputType and 0x0f
        val variation = inputType and 0x0ff0
        return (inputClass == 1 && variation in setOf(0x80, 0x90, 0xe0)) ||
            (inputClass == 2 && variation == 0x10)
    }
}
