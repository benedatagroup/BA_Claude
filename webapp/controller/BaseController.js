sap.ui.define([
    "sap/ui/core/mvc/Controller"
], (Controller) => {
    "use strict";

    return Controller.extend("baclaude.controller.BaseController", {

        /** Convenience accessor for the application router. */
        getRouter() {
            return this.getOwnerComponent().getRouter();
        },

        /** Returns a named model attached to the view or the owning component. */
        getModel(sName) {
            return this.getView().getModel(sName) || this.getOwnerComponent().getModel(sName);
        },

        /** Sets a model on the view. */
        setModel(oModel, sName) {
            return this.getView().setModel(oModel, sName);
        },

        /** Returns the i18n resource bundle. */
        getResourceBundle() {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        }
    });
});
