function submitInvoice() {
    // Prevent double submission
    const submitBtn = event.target;
    if (submitBtn.disabled) {
        console.log('Submit already in progress, ignoring click');
        return;
    }
    
    // Immediately disable button
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Submitting to Notion...';
    
    // Collect all form data
    const selectedTier = document.querySelector('input[name="tier"]:checked');
    if (!selectedTier && document.getElementById('invoiceTypeSelect').value === 'retainer') {
        alert('Please select a retainer tier before submitting.');
        // Re-enable button on validation error
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        return;
    }
    
    const formData = {
        submissionType: submissionType,
        invoiceMethod: invoiceMethod,
        name: document.getElementById('nameInput').value,
        email: document.getElementById('emailInput').value,
        discord: document.getElementById('discordInput').value,
        phone: document.getElementById('phoneInput').value,
        address: document.getElementById('addressInput').value,
        contact: document.getElementById('contactInput')?.value,
        bankName: document.getElementById('bankInput')?.value,
        accountName: document.getElementById('accountNameInput')?.value,
        accountNumber: document.getElementById('accountNumberInput')?.value,
        sortCode: document.getElementById('sortCodeInput')?.value,
        brand: 'Dr Dent',
        invoiceType: document.getElementById('invoiceTypeSelect').value,
        period: document.getElementById('periodInput').value,
        selectedTier: selectedTier ? selectedTier.value : null,
        accounts: []
    };

    // Add VAT information to formData
    const vatStatus = document.querySelector('input[name="vatStatus"]:checked');
    if (vatStatus) {
        formData.vatRegistered = vatStatus.value;
        formData.vatNumber = document.getElementById('vatNumberInput').value;
    }
    
    // Collect account data (without files for now)
    for (let i = 1; i <= accountCount; i++) {
        const handleInput = document.getElementById(`handle${i}`);
        if (handleInput && handleInput.value) {
            formData.accounts.push({
                handle: handleInput.value,
                fileCount: uploadedFiles[i] ? uploadedFiles[i].length : 0
            });
        }
    }
    
    console.log('Submitting form data as JSON:', formData);
    
    // Submit as JSON (temporarily removing file uploads)
    fetch('/.netlify/functions/submit-invoice', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
    })
    .then(response => {
        console.log('Response status:', response.status);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    })
    .then(result => {
        console.log('Success response:', result);
        if (result.success) {
            console.log('Debug info:', result.debug);
            console.log('Invoice title created:', result.invoiceTitle);
            
            // Update success email
            const email = document.getElementById('emailInput').value || 'john@example.com';
            document.getElementById('successEmail').textContent = email;
            goToStep(5);
        } else {
            alert('Error submitting invoice: ' + result.error);
            // Re-enable button on error
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Error submitting invoice: ' + error.message);
        // Re-enable button on error
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    });
    
    // Note: Button stays disabled on success to prevent re-submission
}
