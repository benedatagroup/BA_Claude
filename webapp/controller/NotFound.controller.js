sap.ui.define([
    "./BaseController"
], (BaseController) => {
    "use strict";

    return BaseController.extend("baclaude.controller.NotFound", {

        onNavBack() {
            this.getRouter().navTo("worklist", {}, true);
        }
    });
});
