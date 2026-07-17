export default function SwitchButton({
    isOn, onToggle, additionalClassStyle="", readOnly=false,
    onText="Ready", offText="Spent", width="w-20", ...otherProps
}) {
    return (
        <div {...otherProps}
            onClick={() => { if(!readOnly) onToggle(!isOn) }}
            className={`relative flex-shrink-0 ${width} h-8 flex items-center cursor-pointer rounded-full transition-colors duration-300 ${isOn ? "bg-green-500" : "bg-red-500"} text-xs ${additionalClassStyle}`}
        >
            {/* The Dot */}
            {!readOnly && (
                <div
                    className={`absolute w-7 h-7 bg-white rounded-full transition-all duration-300 shadow-sm
                        ${isOn ? "left-[calc(100%-30px)]" : "left-[2px]"}`}
                ></div>
            )}

            {/* The Text */}
            <span className={`w-full flex px-3 text-white font-bold transition-all ${isOn ? "justify-start" : "justify-end"}`}>
                {isOn ? onText : offText}
            </span>
        </div>
    );
}
