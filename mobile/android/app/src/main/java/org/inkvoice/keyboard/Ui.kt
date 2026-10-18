package org.inkvoice.keyboard

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

object Ui {
    val background = Color.rgb(246, 247, 249)
    val text = Color.rgb(32, 35, 41)
    val secondary = Color.rgb(96, 102, 111)
    val blue = Color.rgb(0, 102, 214)
    val red = Color.rgb(180, 35, 24)
    fun Context.dp(value: Int): Int = (resources.displayMetrics.density * value + .5f).toInt()
    fun text(context: Context, value: String, size: Float = 14f, bold: Boolean = false): TextView = TextView(context).apply {
        text = value; textSize = size; setTextColor(if (bold) Ui.text else secondary)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setLineSpacing(context.dp(3).toFloat(), 1f)
    }
    fun column(context: Context): LinearLayout = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    fun card(context: Context): LinearLayout = column(context).apply {
        setPadding(context.dp(16), context.dp(16), context.dp(16), context.dp(16))
        background = GradientDrawable().apply {
            setColor(Color.WHITE); cornerRadius = context.dp(12).toFloat(); setStroke(context.dp(1), Color.rgb(225, 228, 232))
        }
    }
    fun button(context: Context, title: String, primary: Boolean = false, action: (View) -> Unit): Button = Button(context).apply {
        text = title; textSize = 14f; isAllCaps = false; minHeight = context.dp(44)
        if (primary) { backgroundTintList = ColorStateList.valueOf(blue); setTextColor(Color.WHITE) }
        else { backgroundTintList = ColorStateList.valueOf(Color.rgb(235, 239, 245)); setTextColor(Ui.text) }
        setOnClickListener(action)
    }
    fun space(context: Context, height: Int): View = View(context).apply {
        layoutParams = LinearLayout.LayoutParams(1, context.dp(height))
    }
}
