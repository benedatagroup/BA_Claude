sap.ui.define([
    "sap/ui/core/library",
    "sap/ui/core/format/DateFormat",
    "sap/ui/core/format/NumberFormat"
], (coreLibrary, DateFormat, NumberFormat) => {
    "use strict";

    const ValueState = coreLibrary.ValueState;

    return {

        /**
         * Returns the translated, human readable status text for a given status key.
         * Falls back to the raw status if no translation is found.
         */
        statusText(sStatus) {
            if (!sStatus) {
                return "";
            }
            const oBundle = this.getView().getModel("i18n").getResourceBundle();
            return oBundle.getText("status" + sStatus, undefined, sStatus);
        },

        /**
         * Returns the sap.ui.core.ValueState that corresponds to a given status.
         * Used by sap.m.ObjectStatus to color the status chip.
         */
        statusState(sStatus) {
            switch (sStatus) {
                case "Posted":
                    return ValueState.Success;
                case "Draft":
                    return ValueState.Error;
                default:
                    return ValueState.None;
            }
        },

        /**
         * Returns the SAP icon URI that visually represents a status.
         */
        statusIcon(sStatus) {
            switch (sStatus) {
                case "Posted":
                    return "sap-icon://accept";
                case "Draft":
                    return "sap-icon://edit";
                default:
                    return "";
            }
        },

        /**
         * Formats a JS Date (or null) for display using the user's locale.
         */
        formatDate(vDate) {
            if (!vDate) {
                return "";
            }
            const oFormat = DateFormat.getDateInstance({ style: "medium" });
            return oFormat.format(vDate);
        },

        /**
         * Formats a numeric amount with grouping but without a currency symbol.
         * The currency code is rendered separately by sap.m.ObjectNumber#unit.
         */
        formatAmount(vAmount, sCurrency) {
            if (vAmount === null || vAmount === undefined || vAmount === "") {
                return "";
            }
            const oFormat = NumberFormat.getCurrencyInstance({ showMeasure: false });
            return oFormat.format(vAmount, sCurrency || "EUR");
        }
    };
});
